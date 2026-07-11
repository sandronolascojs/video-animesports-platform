import {
	type StandardRPCCustomJsonSerializer,
	StandardRPCJsonSerializer,
} from "@orpc/client/standard";

/**
 * Custom Date serializer (type 21, the first id past oRPC's reserved built-in range).
 * This is part of the contract: it MUST be applied identically everywhere a Date crosses
 * a process boundary in this app, otherwise Date fields silently degrade to strings on one
 * side of the wire:
 *  - apps/web RPCLink (browser + RSC clients) — encodes/decodes Dates in requests/responses
 *  - apps/server RPCHandler — decodes/encodes Dates the same way on the server
 *  - apps/web QueryClient — key hashing and dehydrate/hydrate, so an RSC prefetch that
 *    hands off to a client `useQuery` keeps Date instances instead of turning them into
 *    plain strings across the hydration boundary
 * Doc: https://orpc.dev/docs/advanced/rpc-json-serializer
 */
export const dateSerializer: StandardRPCCustomJsonSerializer = {
	type: 21,
	condition: (data) => data instanceof Date,
	serialize: (data: Date) => data.toISOString(),
	deserialize: (data: string) => new Date(data),
};

export const customJsonSerializers: StandardRPCCustomJsonSerializer[] = [
	dateSerializer,
];

/**
 * Shared StandardRPCJsonSerializer instance carrying `customJsonSerializers`. RPCLink and
 * RPCHandler accept `customJsonSerializers` directly as a constructor option. Consumers that
 * need the single-value `{ json, meta }` envelope used by TanStack Query's `queryKeyHashFn`
 * and `dehydrate`/`hydrate` hooks (see apps/web/src/libs/orpc/query-client.ts) wrap this
 * instance in a `StandardRPCSerializer`.
 * Doc: https://orpc.dev/docs/integrations/tanstack-query
 */
export const serializer = new StandardRPCJsonSerializer({
	customJsonSerializers,
});
