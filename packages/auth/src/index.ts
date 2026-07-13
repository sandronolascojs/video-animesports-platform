import { db } from "@video-platform-challenge/db";
import * as schema from "@video-platform-challenge/db/schema";
import { env } from "@video-platform-challenge/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export function createAuth() {
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
			// uncomment crossSubDomainCookies setting when ready to deploy and replace <your-workers-subdomain> with your actual workers subdomain
			// https://developers.cloudflare.com/workers/wrangler/configuration/#workersdev
			// crossSubDomainCookies: {
			//   enabled: true,
			//   domain: "<your-workers-subdomain>",
			// },
		},
	});
}
