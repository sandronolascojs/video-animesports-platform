// The SSE fan-out relay for one project (RT-3, docs
// realtime-and-render-lock-v1.md §1): holds the connected `EventSource`
// clients for ONE project and pushes each already-persisted status
// transition to them as it happens. Postgres stays the source of truth —
// this DO holds no authoritative state of its own, only the live writer set
// (docs "the DO is a fan-out relay only"). Deliberately thin: every piece of
// actual bookkeeping (add/remove/format/evict) lives in
// lib/project-events-registry.ts, which — unlike this file — doesn't import
// `cloudflare:workers` and so runs under plain `bun:test` (see that file's
// own doc comment). This class can only be exercised by a live Worker.
//
// Must stay a NAMED export re-exported from src/index.ts, mirroring
// `VideoGenerationWorkflow`: the `PROJECT_EVENTS` binding
// (packages/infra/alchemy.run.ts) resolves this class by `className` off
// the worker's compiled script, not via a module path.
import { DurableObject } from "cloudflare:workers";
import type { ProjectEvent } from "@video-platform-challenge/api";

import {
	createProjectEventRegistry,
	type ProjectEventRegistry,
} from "../lib/project-events-registry";

// docs §1 piece 1: "~25s heartbeat so intermediaries don't drop idle connections".
const HEARTBEAT_INTERVAL_MS = 25_000;

export class ProjectEventsDO extends DurableObject<Env> {
	private readonly registry: ProjectEventRegistry =
		createProjectEventRegistry();
	private heartbeatTimer: ReturnType<typeof setInterval> | undefined;

	/**
	 * Upgrades a request into an SSE stream and registers its writer. The
	 * caller (`GET /projects/:projectId/events` in apps/server/src/index.ts)
	 * has already verified session + ownership before forwarding here — this
	 * layer trusts the request unconditionally in return for staying dumb (no
	 * db/auth access from inside the DO, matching docs "fan-out relay only").
	 */
	async fetch(request: Request): Promise<Response> {
		const { readable, writable } = new TransformStream<
			Uint8Array,
			Uint8Array
		>();
		const writer = writable.getWriter();

		if (!this.registry.add(writer)) {
			await writer.close().catch(() => {});
			return new Response("Too many active connections for this project", {
				status: 503,
			});
		}

		this.startHeartbeat();

		// Belt: an explicit disconnect signal, when the runtime fires it.
		// Suspenders: even if it never fires for a given transport, the
		// heartbeat loop below evicts this writer on its next failed write
		// anyway (`ProjectEventRegistry.heartbeat`'s doc comment) — dead
		// writers never accumulate for longer than one heartbeat interval.
		request.signal.addEventListener("abort", () => {
			this.registry.remove(writer);
			writer.close().catch(() => {});
			if (this.registry.size() === 0) {
				this.stopHeartbeat();
			}
		});

		return new Response(readable, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	}

	/**
	 * RPC-callable from the worker via the stub (docs §1 piece 1/4) —
	 * `lib/notify-project-event.ts` is every caller's try/catch wrapper; a
	 * throw here (e.g. every writer having just been evicted) is swallowed
	 * there, never allowed to fail the generation step or DB commit that
	 * triggered the notify.
	 */
	async broadcast(event: ProjectEvent): Promise<void> {
		await this.registry.broadcast(event);
	}

	private startHeartbeat(): void {
		if (this.heartbeatTimer) {
			return;
		}
		this.heartbeatTimer = setInterval(() => {
			this.registry.heartbeat().catch(() => {});
			if (this.registry.size() === 0) {
				this.stopHeartbeat();
			}
		}, HEARTBEAT_INTERVAL_MS);
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = undefined;
		}
	}
}
