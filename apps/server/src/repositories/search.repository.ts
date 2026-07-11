import type { UserScopedTx } from "@video-platform-challenge/db";
import { assets, projects } from "@video-platform-challenge/db/schema";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

// Every query here filters by userId explicitly on top of running inside a
// withUser() transaction — RLS is the backstop, not the only wall.

/**
 * Subsequence ILIKE pattern: "bas pro" → "%bas%pro%". Pragmatic fuzz — each
 * term must appear, in order, anywhere in the haystack. `%`/`_`/`\` in user
 * input are escaped so they match literally instead of acting as wildcards.
 */
export function toFuzzyPattern(query: string): string {
	const terms = query
		.trim()
		.split(/\s+/)
		.map((term) => term.replace(/[\\%_]/g, (match) => `\\${match}`))
		.filter(Boolean);
	return `%${terms.join("%")}%`;
}

const RESULT_LIMIT = 10;

export async function searchProjects(
	tx: UserScopedTx,
	userId: string,
	pattern: string,
) {
	return tx
		.select({
			id: projects.id,
			title: projects.title,
			templateKey: projects.templateKey,
			createdAt: projects.createdAt,
		})
		.from(projects)
		.where(and(eq(projects.userId, userId), ilike(projects.title, pattern)))
		.orderBy(desc(projects.createdAt))
		.limit(RESULT_LIMIT);
}

export async function searchAssets(
	tx: UserScopedTx,
	userId: string,
	pattern: string,
) {
	return tx
		.select({
			id: assets.id,
			projectId: assets.projectId,
			projectTitle: projects.title,
			kind: assets.kind,
			createdAt: assets.createdAt,
		})
		.from(assets)
		.innerJoin(projects, eq(assets.projectId, projects.id))
		.where(
			and(
				eq(assets.userId, userId),
				or(
					// kind is a pgEnum — cast to text for ILIKE.
					sql`${assets.kind}::text ilike ${pattern}`,
					ilike(projects.title, pattern),
				),
			),
		)
		.orderBy(desc(assets.createdAt))
		.limit(RESULT_LIMIT);
}
