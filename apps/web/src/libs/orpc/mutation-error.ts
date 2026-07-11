import { ORPCError } from "@orpc/client";

import { toast } from "@/libs/toast";

/**
 * Shared mutation-error → toast bridge. `libs/orpc/query-client.ts`'s global
 * `QueryCache.onError` only ever fires for `useQuery` failures — mutations
 * are triggered one-off from each feature's query hooks, so every mutation's
 * `onError` calls this instead of hand-rolling the same toast shape. Reuses
 * the exact toast surface (`@/libs/toast`) the query-client handler already
 * uses, so a mutation failure looks identical to a query failure.
 *
 * `codeMessages` lets a call site override copy for a specific oRPC-typed
 * error code it declared via `.errors()` (e.g. `RATE_LIMITED` on project
 * creation gets friendlier copy than the raw contract message) — anything
 * else falls back to the error's own message.
 *
 * Uses `instanceof ORPCError` rather than `isDefinedError` — the latter's
 * signature (`isDefinedError<T>(error: T): error is Extract<T,
 * ORPCError<any, any>>`) resolves `Extract<unknown, ORPCError<any, any>>` to
 * `never` for a mutation's plain `unknown` error, since it's built to narrow
 * against a specific procedure's declared error union, not an arbitrary
 * caught error. Every oRPC error (typed or not) is still an `ORPCError`
 * instance with a `.code`, which is all this needs.
 */
export function toastMutationError(
	error: unknown,
	options?: {
		title?: string;
		codeMessages?: Partial<Record<string, string>>;
	},
) {
	const title = options?.title ?? "Request failed";
	const overrideMessage =
		error instanceof ORPCError && options?.codeMessages
			? options.codeMessages[error.code]
			: undefined;
	const description =
		overrideMessage ??
		(error instanceof Error ? error.message : "Something went wrong.");

	toast.error({ description, title });
}
