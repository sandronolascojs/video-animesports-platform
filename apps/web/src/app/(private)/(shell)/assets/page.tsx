import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import type { SearchParams } from "nuqs/server";
import { Suspense } from "react";

import { AssetsView } from "@/feature/assets/views/assets-view";
import { getQueryClient } from "@/libs/orpc";
import { orpcServer } from "@/libs/orpc/query.server";
import { assetsSearchParamsCache } from "@/libs/pagination/search-params";

/**
 * /assets — parses the search params through the SAME nuqs parsers the
 * client view binds with `useQueryStates`, and SSR-prefetches that exact
 * `assets.page` query. The view still needs a Suspense boundary (nuqs reads
 * `useSearchParams` under the hood in the app router).
 */
export default async function AssetsPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	const { page, pageSize, sortBy, sortDirection, kind, status } =
		await assetsSearchParamsCache.parse(searchParams);

	const queryClient = getQueryClient();
	await queryClient.prefetchQuery(
		orpcServer.assets.page.queryOptions({
			input: {
				page,
				pageSize,
				sortBy,
				sortDirection,
				kind: kind ?? undefined,
				status: status ?? undefined,
			},
		}),
	);

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			<Suspense>
				<AssetsView />
			</Suspense>
		</HydrationBoundary>
	);
}
