import "server-only";

import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import { orpcServerClient } from "./client.server";

/**
 * Server-side oRPC + TanStack Query bridge for RSC prefetch. Produces the SAME query keys
 * as the browser `orpc` utils, so `queryClient.prefetchQuery(orpcServer.x.queryOptions())`
 * in an RSC hydrates the matching client `useQuery(orpc.x.queryOptions())`.
 * Doc: https://orpc.dev/docs/best-practices/optimize-ssr
 */
export const orpcServer = createTanstackQueryUtils(orpcServerClient);
