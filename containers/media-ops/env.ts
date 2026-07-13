// Typed, validated env for the media-ops container — mirrors the repo's
// `packages/env` discipline (validate at the boundary, never read raw
// `process.env` in app code). Uses plain zod (catalog-pinned, same version
// every other package validates env with) rather than a `@t3-oss/env-*`
// wrapper: those wrap zod for framework-specific `client`/`server` splits
// (Next.js public env, Cloudflare Workers bindings) this container doesn't
// have — it's a plain Node process with two env vars.
import { z } from "zod";

const envSchema = z.object({
	PORT: z.coerce.number().int().positive().default(8080),
	// Optional so a pure local run (`tsx server.ts` with no secret) still
	// works — when unset the server allows requests through and warns once.
	// alchemy sets it on both the container and the Worker binding everywhere
	// else. `min(1)` rejects an explicitly-empty value the same way the
	// previous hand-rolled validator did (empty string is a config mistake,
	// not "unset").
	MEDIA_OPS_SECRET: z.string().min(1).optional(),
});

export const env = envSchema.parse(process.env);
