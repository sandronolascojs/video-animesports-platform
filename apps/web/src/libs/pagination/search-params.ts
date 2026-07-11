import {
	AssetKind,
	AssetSortField,
	AssetStatus,
	DEFAULT_PAGE,
	DEFAULT_PAGE_SIZE,
	ProjectSortField,
	ProjectStatus,
	SortDirection,
	TemplateKey,
} from "@video-platform-challenge/types";
import {
	createSearchParamsCache,
	parseAsInteger,
	parseAsString,
	parseAsStringLiteral,
} from "nuqs/server";

/**
 * nuqs parser sets for the paginated pages — ONE definition drives both
 * sides: server pages parse `searchParams` through the caches (typed SSR
 * prefetch input), client views bind the same parsers with
 * `useQueryStates` (typed URL state, shallow replace — react-query refetches
 * client-side, the server component never needs to re-run on a page flip).
 * `parseAsStringLiteral` narrows sortBy/kind to the shared
 * `packages/types` unions, so the values feed the oRPC page inputs without
 * casts.
 */

const SORT_DIRECTIONS = [SortDirection.ASC, SortDirection.DESC] as const;

function createPaginationParsers<T extends string>(
	sortFields: readonly T[],
	defaultSort: T,
) {
	return {
		page: parseAsInteger.withDefault(DEFAULT_PAGE),
		pageSize: parseAsInteger.withDefault(DEFAULT_PAGE_SIZE),
		sortBy: parseAsStringLiteral(sortFields).withDefault(defaultSort),
		sortDirection: parseAsStringLiteral(SORT_DIRECTIONS).withDefault(
			SortDirection.DESC,
		),
	};
}

export const projectsPageParams = {
	...createPaginationParsers(
		Object.values(ProjectSortField),
		ProjectSortField.CREATED_AT,
	),
	status: parseAsStringLiteral(Object.values(ProjectStatus)),
	template: parseAsStringLiteral(Object.values(TemplateKey)),
};

export const assetsPageParams = {
	...createPaginationParsers(
		Object.values(AssetSortField),
		AssetSortField.CREATED_AT,
	),
	kind: parseAsStringLiteral(Object.values(AssetKind)),
	status: parseAsStringLiteral(Object.values(AssetStatus)),
	// The `?asset=` deep link (command palette → info modal).
	asset: parseAsString,
};

export const projectsSearchParamsCache =
	createSearchParamsCache(projectsPageParams);
export const assetsSearchParamsCache =
	createSearchParamsCache(assetsPageParams);
