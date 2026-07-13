import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import {
	type AppRouterClient,
	customJsonSerializers,
} from "@video-platform-challenge/api";
import { env } from "@video-platform-challenge/env/web";

import { getServerUrl } from "@/libs/utils";

/**
 * Browser oRPC link. Base path MUST be exactly `${serverUrl}/rpc` to match the apps/server
 * RPCHandler prefix. The Better Auth session cookie is sent because fetch uses
 * credentials:"include" (same auth model as apps/web/src/libs/auth/client.ts). The shared
 * customJsonSerializers mirror the server handler so typed Date outputs deserialize back to
 * real Date objects.
 * Doc: https://orpc.dev/docs/adapters/next + https://orpc.dev/docs/client/rpc-link
 */
const link = new RPCLink({
	url: `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/rpc`,
	fetch: (request, init) => fetch(request, { ...init, credentials: "include" }),
	customJsonSerializers,
	interceptors: [
		onError((error) => {
			// A cancelled in-flight request (component unmount, or an SSE event
			// calling `queryClient.invalidateQueries`) rejects with `AbortError`.
			// That's normal TanStack Query cancellation, not a failure — don't
			// spam the console with it; log everything else unchanged.
			if (error instanceof Error && error.name === "AbortError") {
				return;
			}
			console.error(error);
		}),
	],
});

/**
 * Typed from the CONTRACT (not the server's `typeof appRouter`). Keeps the Next.js bundle
 * free of server code and enforces the contract-first boundary; typed errors declared via
 * oc.errors() are inferred here for isDefinedError narrowing.
 * Doc: https://orpc.dev/docs/contract-first/implement-contract
 */
export const orpcClient: AppRouterClient = createORPCClient(link);
