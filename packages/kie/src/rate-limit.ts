export interface TokenBucketOptions {
	/** Max tokens the bucket can hold (= max requests allowed per `refillIntervalMs`). */
	capacity: number;
	/** Milliseconds over which the bucket fully refills. */
	refillIntervalMs: number;
}

export interface TokenBucket {
	/** Resolves once a token is available, consuming it. */
	take(): Promise<void>;
}

/**
 * kie.ai's documented account-wide limit
 * (docs/video-engine-architecture.md §3): 20 createTask calls per 10
 * seconds; 429 with no server-side queueing beyond that.
 */
export const KIE_RATE_LIMIT: TokenBucketOptions = {
	capacity: 20,
	refillIntervalMs: 10_000,
};

/**
 * In-memory token bucket. IMPORTANT — this is scoped to the current isolate
 * only: it does NOT coordinate across concurrent Worker instances or
 * parallel Workflow steps running in different isolates, so it cannot by
 * itself enforce kie.ai's account-wide 20/10s limit. Real throttling comes
 * from the Workflow pacing its steps sequentially
 * (docs/video-engine-architecture.md §4 — "sequential-per-project is
 * naturally under the limit"). Use this as a best-effort guard against
 * bursts *within* one step/isolate (e.g. fanning out a handful of
 * createTask calls for one batch of keyframes), not as the system's sole
 * rate limiter.
 */
export function createTokenBucket({
	capacity,
	refillIntervalMs,
}: TokenBucketOptions): TokenBucket {
	let tokens = capacity;
	let lastRefill = Date.now();

	function refill(): void {
		const now = Date.now();
		const elapsedMs = now - lastRefill;
		if (elapsedMs <= 0) {
			return;
		}
		const replenished = Math.floor((elapsedMs / refillIntervalMs) * capacity);
		if (replenished > 0) {
			tokens = Math.min(capacity, tokens + replenished);
			lastRefill = now;
		}
	}

	async function take(): Promise<void> {
		for (;;) {
			refill();
			if (tokens > 0) {
				tokens -= 1;
				return;
			}
			await sleep(refillIntervalMs / capacity);
		}
	}

	return { take };
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
