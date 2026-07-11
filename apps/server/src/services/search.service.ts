import type { SearchResults } from "@video-platform-challenge/api";
import { db, withUser } from "@video-platform-challenge/db";

import type { Context } from "../lib/context";
import * as searchRepository from "../repositories/search.repository";

type SessionUser = NonNullable<Context["session"]>;

/**
 * Fuzzy search over the caller's projects and assets for the command
 * palette. One transaction, two scoped reads — matching is a subsequence
 * ILIKE (see `toFuzzyPattern`), newest first, 10 hits per group.
 */
export async function query({
	session,
	query: rawQuery,
}: {
	session: SessionUser;
	query: string;
}): Promise<SearchResults> {
	const pattern = searchRepository.toFuzzyPattern(rawQuery);

	return withUser(db, session.user.id, async (tx) => {
		const projects = await searchRepository.searchProjects(
			tx,
			session.user.id,
			pattern,
		);
		const assets = await searchRepository.searchAssets(
			tx,
			session.user.id,
			pattern,
		);
		return { projects, assets };
	});
}
