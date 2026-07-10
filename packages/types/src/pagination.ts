import { z } from "zod";

/**
 * Shared pagination contract: every paginated endpoint
 * takes the same query shape and returns `{ items, meta }` with the same
 * metadata, so list UIs (layout, filters, pagination bar) are one reusable
 * surface. Lives here — not in packages/api — so the constants and helpers
 * are reachable from every layer (user call).
 */

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 100;
export const PAGE_SIZE_OPTIONS = [12, 24, 48] as const;

export const SortDirection = {
	ASC: "asc",
	DESC: "desc",
} as const;
export type SortDirection = (typeof SortDirection)[keyof typeof SortDirection];

/** Sortable columns the projects page accepts. */
export const ProjectSortField = {
	CREATED_AT: "created_at",
	TITLE: "title",
} as const;
export type ProjectSortField =
	(typeof ProjectSortField)[keyof typeof ProjectSortField];

/** Sortable columns the assets page accepts. */
export const AssetSortField = {
	CREATED_AT: "created_at",
	KIND: "kind",
} as const;
export type AssetSortField =
	(typeof AssetSortField)[keyof typeof AssetSortField];

/** page/pageSize/sortDirection — every list query starts here. */
export const paginationBaseSchema = z.object({
	page: z.coerce.number().int().positive().default(DEFAULT_PAGE),
	pageSize: z.coerce
		.number()
		.int()
		.positive()
		.max(MAX_PAGE_SIZE)
		.default(DEFAULT_PAGE_SIZE),
	sortDirection: z
		.enum([SortDirection.ASC, SortDirection.DESC])
		.default(SortDirection.DESC),
});

/**
 * Build a pagination query whose `sortBy` is constrained to a resource's
 * sortable fields — pass the resource's `*SortField` constant; `z.enum(obj)`
 * validates against its VALUES. Unknown fields are rejected at the boundary.
 */
export const createPaginationQuerySchema = <
	const TFields extends Record<string, string>,
>(
	sortableFields: TFields,
) =>
	paginationBaseSchema.extend({
		sortBy: z.enum(sortableFields).optional(),
	});

export type PaginationQuery = z.infer<typeof paginationBaseSchema> & {
	sortBy?: string;
};

/** Response metadata — identical shape on every paginated endpoint. */
export const paginationMetaSchema = z.object({
	page: z.number().int().positive(),
	pageSize: z.number().int().positive(),
	total: z.number().int().nonnegative(),
	totalPages: z.number().int().nonnegative(),
	hasNextPage: z.boolean(),
	hasPreviousPage: z.boolean(),
});

export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

/** `{ items: T[], meta }` — the one paginated envelope. */
export const createPaginatedResponseSchema = <T extends z.ZodTypeAny>(
	itemSchema: T,
) =>
	z.object({
		items: z.array(itemSchema),
		meta: paginationMetaSchema,
	});

export function calculatePaginationMeta(
	total: number,
	page: number,
	pageSize: number,
): PaginationMeta {
	const totalPages = Math.max(1, Math.ceil(total / pageSize));
	return {
		page,
		pageSize,
		total,
		totalPages,
		hasNextPage: page < totalPages,
		hasPreviousPage: page > 1,
	};
}
