// The ffmpeg media-ops Container (docs/media-ops-container.md §2): a thin
// Cloudflare Container wrapper around the stateless HTTP + ffmpeg server that
// lives in containers/media-ops/. The Worker reaches it through
// lib/media-ops.ts via getContainer(env.MEDIA_OPS, ...); this class declares
// the container's runtime knobs (port + idle sleep) AND self-forwards the
// Worker's MEDIA_OPS_SECRET binding into the container process — alchemy's
// `Container()` resource has no runtime `environment_variables`/`secrets`
// prop (see alchemy.run.ts's `mediaOps` doc comment for the full story), so
// the only way this container ever sees the secret is this class handing it
// down via the `@cloudflare/containers` base class's `envVars` field.
//
// Must stay a NAMED export re-exported from src/index.ts, mirroring
// VideoGenerationWorkflow / ProjectEventsDO: the MEDIA_OPS binding
// (packages/infra/alchemy.run.ts) resolves this class by `className` off the
// worker's compiled script, not via a module path.
import { Container } from "@cloudflare/containers";

export class MediaOpsContainer extends Container<Env> {
	// The server inside the image listens here (containers/media-ops/server.ts
	// defaults to 8080; the Dockerfile EXPOSEs 8080).
	defaultPort = 8080;
	// Scale to zero when idle — pay-per-use (docs §2).
	sleepAfter = "2m";

	// Typed off the base class's own constructor (rather than re-declaring
	// `ctx`/`env` params by hand) so this stays correct if `Container`'s
	// `DurableObjectState` generic ever changes — `Container<Env>`'s `ctx` is
	// `DurableObjectState<{}>`, which a hand-written `DurableObjectState`
	// (defaults to `Props = unknown`) doesn't structurally match.
	constructor(...args: ConstructorParameters<typeof Container<Env>>) {
		super(...args);
		const env = args[1];
		// Only set when bound — an unset secret means "pure local run", which
		// the container itself already treats as allowed (server.ts's own doc
		// comment); an empty `envVars` object here just forwards nothing.
		if (env.MEDIA_OPS_SECRET) {
			this.envVars = { MEDIA_OPS_SECRET: env.MEDIA_OPS_SECRET };
		}
	}
}
