/**
 * Client-safe barrel. MUST NOT import client.server.ts / query.server.ts — those pull in
 * "server-only", which throws if evaluated from a Client Component. Server code (RSC pages,
 * server actions) imports "@/libs/orpc/client.server" / "@/libs/orpc/query.server" directly.
 */
export { orpcClient } from "./client";
export { orpc } from "./query";
export { createQueryClient, getQueryClient } from "./query-client";
