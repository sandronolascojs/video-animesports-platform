import { Pool } from "@neondatabase/serverless";
import { env } from "@video-platform-challenge/env/server";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "./schema";

export * from "./shared/enums";
export { id } from "./shared/id";
export { isUniqueViolationError } from "./shared/pg-errors";
export type { UserScopedTx } from "./shared/with-user";
export { withUser } from "./shared/with-user";

const pool = new Pool({
	connectionString: env.DATABASE_URL || "",
	maxUses: 1,
});

export const db = drizzle({ client: pool, schema });

export type Database = typeof db;
