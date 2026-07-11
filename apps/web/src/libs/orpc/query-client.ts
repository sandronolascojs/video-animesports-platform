import { StandardRPCSerializer } from "@orpc/client/standard";
import { isServer, QueryCache, QueryClient } from "@tanstack/react-query";
import { serializer as jsonSerializer } from "@video-platform-challenge/api";

import { toast } from "@/libs/toast";

/**
 * Wraps the shared StandardRPCJsonSerializer (packages/api/src/serializer.ts) in the RPC
 * envelope helper: `.serialize()` returns a single `{ json, meta }` value and `.deserialize()`
 * consumes it back, which is exactly the shape TanStack Query's `queryKeyHashFn` and
 * `dehydrate`/`hydrate` hooks need. This keeps Date values intact through query-key hashing
 * and through the RSC prefetch -> client hydration boundary, matching the RPCLink/RPCHandler
 * wire format on both ends.
 * Doc: https://orpc.dev/docs/integrations/tanstack-query
 */
const serializer = new StandardRPCSerializer(jsonSerializer);

/**
 * Stable id for the query-cache's global error toast (M8 fix-pass): sileo
 * REPLACES whatever toast already occupies a given id slot instead of
 * stacking a new one (see libs/toast's `generateToastId` doc comment) — a
 * fresh `crypto.randomUUID()` per error meant a network drop during the
 * Studio's 2.5s project poll (plus N in-flight asset-URL queries) stacked
 * dozens of toasts. Every query failure now collapses into this ONE slot.
 */
const CONNECTION_LOST_TOAST_ID = "connection-lost";

/**
 * `assets.getDownloadUrl` is fetched per-asset, in the background, for every
 * thumbnail/preview on screen (Studio's Player timeline, the Assets tab, the
 * dashboard/asset grids — see `feature/studio/hooks/http/use-asset-url.ts`).
 * A single connection drop fails ALL of them at once; none of that is a
 * signal worth surfacing globally — the page's own ErrorStateCard (where one
 * exists) or the plain missing-thumbnail fallback IS the real signal for
 * those. oRPC's tanstack-query key shape is `[[...path], { type, input }]`
 * (`@orpc/tanstack-query`'s `OperationKey`), so the procedure path lives at
 * `queryKey[0]`.
 */
function isAssetDownloadUrlQuery(queryKey: readonly unknown[]): boolean {
	const path = queryKey[0];
	return (
		Array.isArray(path) && path[0] === "assets" && path[1] === "getDownloadUrl"
	);
}

/**
 * Creates a new QueryClient wired to the shared oRPC serializer (key hashing + dehydrate /
 * hydrate) and to a global QueryCache error handler that surfaces query failures as a
 * retryable toast.
 */
export function createQueryClient() {
	return new QueryClient({
		queryCache: new QueryCache({
			onError: (error, query) => {
				// Front-wiring phase 1: `getQueryClient()` also runs on the server
				// (a fresh instance per request, per its own doc comment below) —
				// e.g. a Server Component `fetchQuery`ing inside a try/catch to
				// turn a NOT_FOUND into a designed empty state (see
				// app/(private)/projects/[projectId]/page.tsx) still routes the
				// error through this SAME cache-level `onError`, which fires
				// regardless of whether the caller catches the rejection. `toast`
				// (libs/toast, wrapping the client-only "sileo" lib) throws if
				// invoked outside the browser, crashing that SSR render — guard it
				// to a no-op there; the caller's own catch already decides what the
				// user sees.
				if (isServer) {
					return;
				}
				if (isAssetDownloadUrlQuery(query.queryKey)) {
					return;
				}
				toast.error({
					id: CONNECTION_LOST_TOAST_ID,
					title: "Connection lost — retrying",
					description: error.message,
					action: {
						label: "Retry",
						onClick: () => {
							query.invalidate();
						},
					},
				});
			},
		}),
		defaultOptions: {
			queries: {
				// > 0 so a client useQuery() reads the RSC-prefetched cache entry instead of
				// immediately refetching on mount.
				staleTime: 60 * 1000,
				queryKeyHashFn: (queryKey) =>
					JSON.stringify(serializer.serialize(queryKey)),
			},
			dehydrate: {
				serializeData: (data) => serializer.serialize(data),
			},
			hydrate: {
				deserializeData: (data) => serializer.deserialize(data),
			},
		},
	});
}

let browserQueryClient: QueryClient | undefined;

/**
 * Next.js App Router SSR pattern: a fresh QueryClient per request on the server (so
 * concurrent requests never share cache/state), a singleton in the browser (so React
 * doesn't throw away the client on re-render/suspense).
 * Doc: https://tanstack.com/query/latest/docs/framework/react/guides/ssr
 */
export function getQueryClient() {
	if (isServer) {
		return createQueryClient();
	}

	if (!browserQueryClient) {
		browserQueryClient = createQueryClient();
	}

	return browserQueryClient;
}
