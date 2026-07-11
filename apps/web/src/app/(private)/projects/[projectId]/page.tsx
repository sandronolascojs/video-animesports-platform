import { ORPCError } from "@orpc/client";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { StudioNotFound } from "@/feature/studio/components/studio-not-found";
import { StudioView } from "@/feature/studio/views/studio-view";
import { getQueryClient } from "@/libs/orpc";
import { orpcServer } from "@/libs/orpc/query.server";

export type StudioPageProps = {
	params: Promise<{ projectId: string }>;
};

/**
 * Studio shell (docs/studio-ui.md §4 routes: `projects/[projectId]/page.tsx`).
 * `(private)` layout already enforces the session guard — this page SSR-
 * fetches the full project detail via `orpcServer` (not just prefetches:
 * `fetchQuery` is awaited directly so a `NOT_FOUND` error can be caught here
 * and swapped for the designed not-found state instead of leaking to an
 * error boundary). On success the same fetch's result seeds the query cache
 * `HydrationBoundary`-side (so the client's own polling `useProject` picks
 * up this exact entry with no refetch) AND is passed as `initialDetail` so
 * the Studio draft store never starts empty.
 */
export default async function StudioPage({ params }: StudioPageProps) {
	const { projectId } = await params;
	const queryClient = getQueryClient();

	try {
		const detail = await queryClient.fetchQuery(
			orpcServer.projects.get.queryOptions({ input: { id: projectId } }),
		);

		return (
			<HydrationBoundary state={dehydrate(queryClient)}>
				<StudioView projectId={projectId} initialDetail={detail} />
			</HydrationBoundary>
		);
	} catch (error) {
		// `isDefinedError` narrows against the specific procedure's declared
		// error union — given a plain `catch`-clause `unknown`, `T` resolves to
		// `unknown` and `Extract<unknown, ORPCError<any, any>>` is `never`
		// (`unknown` isn't a member of any union), so it can't be used here. A
		// plain `instanceof` check is sufficient: every oRPC error (typed or
		// not) is an `ORPCError` instance with a `.code`.
		if (error instanceof ORPCError && error.code === "NOT_FOUND") {
			return <StudioNotFound projectId={projectId} />;
		}
		throw error;
	}
}
