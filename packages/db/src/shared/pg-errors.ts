// Postgres error code for `unique_violation`
// (https://www.postgresql.org/docs/current/errcodes-appendix.html). The
// `pg` driver (and drizzle's node-postgres client, which wraps it) attaches
// this as a `.code` string on the thrown error — checked structurally
// rather than via `instanceof` since `pg` doesn't export a dedicated error
// class.
const PG_UNIQUE_VIOLATION = "23505";

/**
 * True when `error` is a Postgres unique-constraint violation — the signal
 * a repository/service uses to turn a lost compare-and-swap race into a
 * typed CONFLICT instead of a 500 (fix-pass C1: e.g. the partial unique
 * index on `project_versions(project_id) WHERE status = 'rendering'`, or
 * the `generation_tasks.step_key` unique index).
 */
export function isUniqueViolationError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
	);
}
