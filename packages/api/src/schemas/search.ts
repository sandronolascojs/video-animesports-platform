import z from "zod";

import { assetKindSchema } from "./asset";
import { templateKeySchema } from "./project";

export const searchInputSchema = z.object({
	query: z.string().trim().min(1).max(100),
});

/**
 * Slim hit shapes — just what the command palette renders. The client
 * navigates by id; anything richer comes from the existing detail
 * endpoints.
 */
export const searchResultsSchema = z.object({
	projects: z.array(
		z.object({
			id: z.string(),
			title: z.string().nullable(),
			templateKey: templateKeySchema,
			createdAt: z.date(),
		}),
	),
	assets: z.array(
		z.object({
			id: z.string(),
			projectId: z.string(),
			projectTitle: z.string().nullable(),
			kind: assetKindSchema,
			createdAt: z.date(),
		}),
	),
});

export type SearchInput = z.infer<typeof searchInputSchema>;
export type SearchResults = z.infer<typeof searchResultsSchema>;
