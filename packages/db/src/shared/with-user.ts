import { sql } from "drizzle-orm";

import type { Database } from "../index";

// The tx handle repositories receive inside withUser() — every query method
// a repository needs (select/insert/update/delete/execute/query…) is
// available on it, exactly like the top-level `db` singleton.
export type UserScopedTx = Parameters<Database["transaction"]>[0] extends (
	tx: infer TTx,
) => unknown
	? TTx
	: never;

// Wraps a request's queries in one transaction scoped to a single tenant.
//
// `select set_config('app.user_id', $1, true)` is the parameterized
// equivalent of `SET LOCAL app.user_id = ...` — Postgres does not accept a
// bind parameter directly after `SET LOCAL name =`, so set_config()'s
// third argument (is_local = true) is used to get the same transaction-only
// scoping without ever string-interpolating the userId into the query text.
//
// Every tenant table's RLS policy (user_id = current_setting('app.user_id',
// true)) then resolves to just this user for the lifetime of the
// transaction. SET LOCAL / set_config(..., true) is transaction-scoped,
// which is what makes this safe on the pooled (maxUses: 1) Neon connection —
// the setting can never leak into another request that reuses the socket.
//
// Repositories write their queries exactly as they would against `db` — RLS
// is the backstop (docs §5d.2), not a replacement for the repository's own
// `where user_id` filters. A query that forgets this wrapper fails closed:
// it sees zero rows, never another tenant's data.
export async function withUser<T>(
	db: Database,
	userId: string,
	fn: (tx: UserScopedTx) => Promise<T>,
): Promise<T> {
	return db.transaction(async (tx) => {
		await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
		return fn(tx);
	});
}
