// Env-gated kie.ai callback resolution. kie.ai can only ever reach this
// server when it's running behind a real public http(s) origin — on
// localhost the request would just fail, so this deliberately returns
// `undefined` there rather than handing kie.ai a URL it can never call back.
// Every kie.ai createTask call in generation.service.ts passes this through
// as `callBackUrl` unconditionally; `undefined` means "omit it entirely",
// which is exactly today's local-dev behavior (see that file's doc comment
// near `paced`/`startWorkflow`).
//
// The workflow's poll loop (workflows/video-generation.ts's `waitForKieTask`)
// stays the source of truth regardless — this callback is a trigger only
// (kie.ai's own docs: "always re-fetch recordInfo before acting"), additive
// and idempotent with polling, never a replacement for it.
import { env } from "@video-platform-challenge/env/server";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

/** True for a well-formed http(s) URL whose host isn't a loopback/local
 * address — split out from `resolveKieCallbackUrl` so the "is this URL
 * reachable from the outside" rule is a pure, independently-checkable unit. */
export function isPublicHttpUrl(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return false;
	}
	return !LOCAL_HOSTNAMES.has(url.hostname.toLowerCase());
}

/**
 * Resolves the kie.ai `callBackUrl` for this deployment, or `undefined` when
 * one wouldn't be reachable. `KIE_CALLBACK_URL` is set in
 * `packages/infra/alchemy.run.ts` (the deployed Worker's own `/webhooks/kie`
 * URL); on localhost it's `""`, so this returns `undefined` and generation
 * falls back to polling.
 */
export function resolveKieCallbackUrl(): string | undefined {
	const callbackUrl = env.KIE_CALLBACK_URL;
	if (!callbackUrl || !isPublicHttpUrl(callbackUrl)) {
		return undefined;
	}
	return callbackUrl;
}
