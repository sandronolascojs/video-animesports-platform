import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import type { SearchParams } from "nuqs/server";
import { Suspense } from "react";

import { ProjectsView } from "@/feature/projects/views/projects-view";
import { getQueryClient } from "@/libs/orpc";
import { orpcServer } from "@/libs/orpc/query.server";
import { projectsSearchParamsCache } from "@/libs/pagination/search-params";

/**
 * /projects — parses the search params through the SAME nuqs parsers the
 * client view binds with `useQueryStates`, and SSR-prefetches that exact
 * `projects.page` query so the grid paints without a loading flash. The view
 * still needs a Suspense boundary (nuqs reads `useSearchParams` under the
 * hood in the app router) — mirrors `assets/page.tsx`.
 */
export default async function ProjectsPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	const { page, pageSize, sortBy, sortDirection, status, template } =
		await projectsSearchParamsCache.parse(searchParams);

	const queryClient = getQueryClient();
	await queryClient.prefetchQuery(
		orpcServer.projects.page.queryOptions({
			input: {
				page,
				pageSize,
				sortBy,
				sortDirection,
				status: status ?? undefined,
				templateKey: template ?? undefined,
			},
		}),
	);

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			<Suspense>
				<ProjectsView />
			</Suspense>
		</HydrationBoundary>
	);
}
