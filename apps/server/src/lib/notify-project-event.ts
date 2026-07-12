// Broadcast-with-try/catch helper for RT-3 (docs
// realtime-and-render-lock-v1.md §1 piece 4): every service-layer call site
// that already persisted a status transition calls this to push it to the
// project's `ProjectEventsDO`. Postgres is already the source of truth by
// the time this runs — a broadcast failure (DO unreachable, a write
// mid-flight, an evicted stub) must NEVER fail the generation step or the DB
// commit that triggered it, so every failure here is caught and logged,
// never rethrown (the client's slow fallback poll — docs §1 piece 6 — still
// reconciles). Centralized here, not duplicated per call site, so the
// try/catch + stub lookup lives in exactly one place.
//
// `ProjectEventsEnv` only needs the `PROJECT_EVENTS` binding, typed against
// the REAL `ProjectEventsDO` class (imported `type`-only — erased at
// compile time, so this file itself never touches `cloudflare:workers` and
// stays importable under plain `bun:test`, unlike durable/project-events.ts
// itself). `packages/infra/alchemy.run.ts` can't express that same binding
// generically (infra and the Worker script are separate TS programs — see
// that file's doc comment on `projectEventsNamespace`), so the real `env`'s
// `PROJECT_EVENTS` type is the untyped `DurableObjectNamespace<any>` alchemy
// produces; `any` is assignable into this file's more specific
// `DurableObjectNamespace<ProjectEventsDO>` parameter type, so callers get a
// real compile-time-checked `.broadcast()` call despite the workspace
// boundary.
import type { ProjectEvent } from "@video-platform-challenge/api";

import type { ProjectEventsDO } from "../durable/project-events";

export type ProjectEventsEnv = {
	PROJECT_EVENTS: DurableObjectNamespace<ProjectEventsDO>;
};

export async function notifyProjectEvent(
	env: ProjectEventsEnv,
	event: ProjectEvent,
): Promise<void> {
	try {
		const id = env.PROJECT_EVENTS.idFromName(event.projectId);
		const stub = env.PROJECT_EVENTS.get(id);
		await stub.broadcast(event);
	} catch (error) {
		console.error(
			`[project-events] failed to broadcast "${event.type}" event for project ${event.projectId}`,
			error,
		);
	}
}
