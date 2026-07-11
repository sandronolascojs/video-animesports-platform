import { oc } from "@orpc/contract";

import { searchInputSchema, searchResultsSchema } from "../schemas/search";

export const searchContract = {
	/**
	 * Fuzzy search over the caller's projects (title) and assets (kind +
	 * parent project title) — powers the ⌘K command palette. Matching is a
	 * subsequence ILIKE (`%term%term%`), scoped by userId + RLS like every
	 * other read.
	 */
	query: oc.input(searchInputSchema).output(searchResultsSchema),
};
