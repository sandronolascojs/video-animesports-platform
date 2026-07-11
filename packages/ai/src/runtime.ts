import type { CacheStore } from "./cache";
import { createInMemoryCacheStore } from "./cache";

export interface AgentDefinition<TInput, TResult> {
	/** Stable per-agent name — namespaces the cache key so two different
	 * agents never collide even if their computed keys coincided. */
	name: string;
	/** Deterministic cache-key material for this call (see cache.ts's
	 * `buildGenerationCacheKey`) — the same input must always produce the
	 * same key. */
	cacheKey: (input: TInput) => string;
	/** Executes the actual agent call. Only invoked on a cache miss; a
	 * rejected call is never cached, so retries always get a fresh call. */
	run: (input: TInput) => Promise<TResult>;
}

export interface CreateProjectRuntimeOptions {
	/** Cache-key/telemetry scope label. Callers without a real per-project id
	 * in scope yet (e.g. plan.service.ts's agent calls, which run before any
	 * project-scoped chat context exists) may pass a stable placeholder —
	 * the generation cache key itself never includes `projectId` (docs §3:
	 * "generation cache: key = hash(model + system + prompt + schema)"), so
	 * this only affects logging/telemetry, never cache correctness. */
	projectId: string;
	cache?: CacheStore;
}

export interface ProjectRuntime {
	projectId: string;
	cache: CacheStore;
	runAgent<TInput, TResult>(
		definition: AgentDefinition<TInput, TResult>,
		input: TInput,
	): Promise<TResult>;
}

export function createProjectRuntime({
	projectId,
	cache = createInMemoryCacheStore(),
}: CreateProjectRuntimeOptions): ProjectRuntime {
	return {
		projectId,
		cache,
		async runAgent<TInput, TResult>(
			definition: AgentDefinition<TInput, TResult>,
			input: TInput,
		): Promise<TResult> {
			const key = `${definition.name}:${definition.cacheKey(input)}`;
			const cached = await cache.get<TResult>(key);
			if (cached !== undefined) {
				return cached;
			}
			const result = await definition.run(input);
			await cache.set(key, result);
			return result;
		},
	};
}
