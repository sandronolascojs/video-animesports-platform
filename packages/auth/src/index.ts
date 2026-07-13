import { db } from "@video-platform-challenge/db";
import * as schema from "@video-platform-challenge/db/schema";
import { env } from "@video-platform-challenge/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

/**
 * On deploy the web and server run on sibling `<worker>.<account>.workers.dev`
 * subdomains. `workers.dev` is a public suffix (verified against the PSL), so
 * `<account>.workers.dev` is a registrable domain and both workers are
 * SAME-SITE under it — but the default session cookie is host-only (scoped to
 * the server's own subdomain), so the web app never receives it and login
 * never sticks. Sharing the cookie on the account-level parent domain fixes
 * it. Returns `undefined` for localhost / bare hosts (nothing to widen to), so
 * local dev keeps the default host-only cookie.
 */
function crossSubDomainCookieDomain(baseUrl: string): string | undefined {
	let host: string;
	try {
		host = new URL(baseUrl).hostname;
	} catch {
		return undefined;
	}
	if (host === "localhost" || /^[\d.]+$/.test(host)) {
		return undefined;
	}
	const labels = host.split(".");
	if (labels.length < 3) {
		return undefined;
	}
	// Drop this worker's own leftmost label → the shared parent both workers
	// sit under (e.g. `server-dev.acme.workers.dev` -> `acme.workers.dev`).
	return labels.slice(1).join(".");
}

export function createAuth() {
	const crossSubDomain = crossSubDomainCookieDomain(env.BETTER_AUTH_URL);
	return betterAuth({
		database: drizzleAdapter(db, {
			provider: "pg",

			schema: schema,
		}),
		trustedOrigins: [env.CORS_ORIGIN],
		emailAndPassword: {
			enabled: true,
		},
		// Session cookie cache: better-auth caches the validated session in a
		// signed cookie, so getSession serves from the cookie instead of hitting
		// the DB on every request — the read only re-validates against Postgres
		// once the cache is older than `maxAge`. A big win on Workers (a DB round
		// trip per request is expensive even through Hyperdrive); the short 60s
		// window keeps staleness bounded (a revoked session clears within a minute).
		session: {
			cookieCache: {
				enabled: true,
				maxAge: 60,
			},
		},
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		rateLimit: {
			enabled: true,
			window: 60,
			max: 100,
			storage: "memory",
		},
		advanced: {
			defaultCookieAttributes: {
				sameSite: "none",
				secure: true,
				httpOnly: true,
			},
			// Cross-origin deploy (web + server on sibling workers.dev
			// subdomains): share the session cookie on the account-level parent
			// domain so the web app actually receives it. Skipped on localhost
			// (host-only is fine there) — see `crossSubDomainCookieDomain` above.
			...(crossSubDomain
				? {
						crossSubDomainCookies: {
							enabled: true,
							domain: crossSubDomain,
						},
					}
				: {}),
		},
	});
}
