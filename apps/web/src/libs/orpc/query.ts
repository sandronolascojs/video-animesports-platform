import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import { orpcClient } from "./client";

/**
 * Browser oRPC + TanStack Query bridge. Use in "use client" components:
 *   useQuery(orpc.healthCheck.queryOptions())
 *   useQuery(orpc.privateData.queryOptions())
 * The SSR/prefetch counterpart is `orpcServer` in ./query.server. Both produce identical
 * query keys per procedure+input, so server prefetch hydrates these client hooks.
 * Doc: https://orpc.dev/docs/integrations/tanstack-query
 */
export const orpc = createTanstackQueryUtils(orpcClient);
