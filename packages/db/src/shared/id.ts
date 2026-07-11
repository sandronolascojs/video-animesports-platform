import { createId } from "@paralleldrive/cuid2";
import { text } from "drizzle-orm/pg-core";

export const id = (name = "id") =>
	text(name)
		.primaryKey()
		.notNull()
		.$defaultFn(() => createId());
