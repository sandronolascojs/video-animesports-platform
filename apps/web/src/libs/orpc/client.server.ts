import "server-only";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import {
	type AppRouterClient,
	customJsonSerializers,
} from "@video-platform-challenge/api";
import { env } from "@video-platform-challenge/env/web";

import { getServerUrl } from "@/libs/utils";

/**
 * Server-side oRPC client for RSC / SSR prefetch.
 *
 * apps/server runs as a SEPARATE Cloudflare Worker (NEXT_PUBLIC_SERVER_URL), not in this
 * Next.js deployment, so the in-process createRouterClient pattern does not apply — using it
 * would require importing the server router (DB/services/auth) into the Next bundle. The
 * oRPC pattern for a cross-origin backend is an RPCLink whose `headers` async-fn forwards
 * next/headers on the server.
 *
 * We forward ONLY the `cookie` header (not the full header set) to avoid forwarding
 * host/content-length/connection across the origin boundary. The cookie carries the Better
 * Auth session, same as apps/web/src/libs/auth/client.ts.
 *
 * Doc: https://orpc.dev/docs/adapters/next
 */
const serverLink = new RPCLink({
	url: `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/rpc`,
	customJsonSerializers,
	headers: async () => {
		const { cookies } = await import("next/headers");
		const cookieHeader = (await cookies()).toString();
		return cookieHeader ? { cookie: cookieHeader } : {};
	},
});

/** Typed from the CONTRACT (no server router import). */
export const orpcServerClient: AppRouterClient = createORPCClient(serverLink);
