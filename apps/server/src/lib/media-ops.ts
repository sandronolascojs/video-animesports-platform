// Worker-side access to the media-ops ffmpeg Container (docs
// media-ops-container.md §4). The container is stateless and dumb (see
// containers/media-ops/server.mjs) — this lib owns the Worker half: it holds no
// R2 creds and signs nothing, it just POSTs an already-signed videoUrl and
// returns the extracted bytes. Callers pass a publicly-fetchable URL that
// ffmpeg reads directly as an http input.
import { getContainer } from "@cloudflare/containers";
import { env } from "@video-platform-challenge/env/server";

import type { MediaOpsContainer } from "../durable/media-ops-container";

// TODO(phase0-probe): validate a real frame + audio extraction end-to-end
// against the deployed (or local-Docker) container before Feature 1 builds on
// this. Exact curl/steps live in scripts/probe-media-ops.md.

async function call(path: string, body: unknown): Promise<Uint8Array> {
	// Narrowing (mirrors lib/notify-project-event.ts's PROJECT_EVENTS cast): the
	// alchemy Container binding maps to a `DurableObjectNamespace` branded only
	// by `Rpc.DurableObjectBranded` (infra can't `import type` the real class —
	// see alchemy.run.ts's `mediaOps` doc comment), which doesn't satisfy
	// `getContainer`'s `T extends Container` constraint. Casting to the real
	// class's namespace here restores a properly-typed `getContainer`/`fetch`
	// without leaking the workspace boundary into infra.
	const namespace =
		env.MEDIA_OPS as unknown as DurableObjectNamespace<MediaOpsContainer>;
	// One warm pool addressed by a stable name; Phase 1 can pass a per-scene id
	// for parallelism (docs §4).
	const container = getContainer(namespace, "media-ops");
	// Shared-secret gate (docs §"Container shared-secret"): `MEDIA_OPS_SECRET`
	// isn't modeled on `Env` yet — the orchestrator adds it to both the
	// container's env and this Worker's binding via alchemy — so it's read via
	// an escape-hatch cast (mirrors the `namespace` cast above) rather than a
	// direct `env.MEDIA_OPS_SECRET` access, which would fail typecheck until
	// that binding lands. Undefined (not yet wired, or a stage that omits it)
	// simply sends no auth header — the container itself treats that as "pure
	// local run" and allows it (server.ts's own doc comment).
	const mediaOpsSecret = (env as unknown as { MEDIA_OPS_SECRET?: string })
		.MEDIA_OPS_SECRET;
	const response = await container.fetch(
		new Request(`http://media-ops${path}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...(mediaOpsSecret
					? { authorization: `Bearer ${mediaOpsSecret}` }
					: {}),
			},
			body: JSON.stringify(body),
		}),
	);
	if (!response.ok) {
		throw new Error(`media-ops ${path} failed: ${response.status}`);
	}
	return new Uint8Array(await response.arrayBuffer());
}

export function extractLastFrame(videoUrl: string): Promise<Uint8Array> {
	return call("/extract-frame", { videoUrl });
}

export function extractAudio(videoUrl: string): Promise<Uint8Array> {
	return call("/extract-audio", { videoUrl });
}
