// Pure fan-out bookkeeping for RT-3's ProjectEventsDO (docs
// realtime-and-render-lock-v1.md §1 piece 1): tracks one project's
// connected SSE writers and formats/broadcasts events to them. Kept
// completely free of `cloudflare:workers` (see durable/project-events.ts's
// doc comment for why that file itself can't run under plain `bun:test`) —
// this is the layer that IS unit-tested; the DO class is just a thin
// `fetch()`/`broadcast()` wrapper around it.
import type { ProjectEvent } from "@video-platform-challenge/api";

/** Per-project subscriber cap (docs §1 piece 1) — a project with more
 * connected clients than this rejects new subscribers rather than growing
 * the fan-out unbounded. */
export const MAX_SUBSCRIBERS_PER_PROJECT = 20;

/** The minimal shape a subscriber needs. `WritableStreamDefaultWriter`
 * satisfies this structurally (durable/project-events.ts passes one
 * directly); tests can pass a plain fake instead of standing up a real
 * stream. */
export interface EventSubscriber {
	write(chunk: Uint8Array): Promise<void>;
}

const encoder = new TextEncoder();

/** Formats one `ProjectEvent` as an SSE `data:` frame. */
export function formatEventFrame(event: ProjectEvent): Uint8Array {
	return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/** The `: ping\n\n` heartbeat comment (docs §1 piece 1) — keeps
 * intermediaries from dropping an idle connection. SSE comment lines never
 * reach `EventSource.onmessage`, so the client silently ignores these. */
export function formatHeartbeatFrame(): Uint8Array {
	return encoder.encode(": ping\n\n");
}

export interface ProjectEventRegistry {
	/** Current subscriber count. */
	size(): number;
	/** Registers a writer; returns `false` (without registering) once the
	 * project is already at `MAX_SUBSCRIBERS_PER_PROJECT`. */
	add(subscriber: EventSubscriber): boolean;
	/** Deregisters a writer (close/abort) — a no-op if it's already gone. */
	remove(subscriber: EventSubscriber): void;
	/** Writes `event` to every registered writer; evicts (removes) any writer
	 * whose write throws/rejects. No-op when there are no subscribers — the
	 * common case (docs §1 piece 1: "nobody watching"). */
	broadcast(event: ProjectEvent): Promise<void>;
	/** Writes the heartbeat comment to every registered writer, evicting the
	 * same way `broadcast` does. */
	heartbeat(): Promise<void>;
}

async function writeToAll(
	subscribers: Set<EventSubscriber>,
	frame: Uint8Array,
): Promise<void> {
	if (subscribers.size === 0) {
		return;
	}
	await Promise.all(
		Array.from(subscribers).map(async (subscriber) => {
			try {
				await subscriber.write(frame);
			} catch {
				subscribers.delete(subscriber);
			}
		}),
	);
}

/** Creates one project's subscriber registry — one instance per
 * `ProjectEventsDO`, held for the DO's in-memory lifetime (never persisted;
 * Postgres is the source of truth, this is only the live writer set). */
export function createProjectEventRegistry(): ProjectEventRegistry {
	const subscribers = new Set<EventSubscriber>();

	return {
		size: () => subscribers.size,
		add: (subscriber) => {
			if (subscribers.size >= MAX_SUBSCRIBERS_PER_PROJECT) {
				return false;
			}
			subscribers.add(subscriber);
			return true;
		},
		remove: (subscriber) => {
			subscribers.delete(subscriber);
		},
		broadcast: (event) => writeToAll(subscribers, formatEventFrame(event)),
		heartbeat: () => writeToAll(subscribers, formatHeartbeatFrame()),
	};
}
