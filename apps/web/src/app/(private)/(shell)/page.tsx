import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { HomeView } from "@/feature/home/views/home-view";
import { getQueryClient } from "@/libs/orpc";
import { orpcServer } from "@/libs/orpc/query.server";

/**
 * `(private)` layout already redirects unauthenticated requests to /login
 * (see `libs/auth/server.ts` `enforceAuth`).
 *
 * SSR-prefetches `projects.list` (docs/studio-ui.md §0 "Recent projects")
 * into the query cache and hands it to the client via `HydrationBoundary` —
 * `HomeView`'s own `useProjects()` picks up this exact cache entry on mount
 * (same query key, per `libs/orpc/query.server.ts`), so the grid never
 * shows an empty/loading flash on first paint.
 */
export default async function HomePage() {
	const queryClient = getQueryClient();
	await queryClient.prefetchQuery(
		orpcServer.projects.list.queryOptions({ input: {} }),
	);

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			<HomeView />
		</HydrationBoundary>
	);
}
