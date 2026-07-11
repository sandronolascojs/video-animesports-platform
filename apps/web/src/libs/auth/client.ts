import { env } from "@video-platform-challenge/env/web";
import { createAuthClient } from "better-auth/react";
import { getServerUrl } from "../utils";

/**
 * Better Auth client instance for use in React components.
 *
 * This client handles authentication state and provides hooks for session management.
 * It uses nano-store for reactive state management and better-fetch for requests.
 *
 * The organizationClient is configured to infer additional fields matching the server
 * configuration, ensuring type safety for custom fields.
 *
 * @see https://www.better-auth.com/docs/concepts/client
 */
export const authClient = createAuthClient({
	baseURL: new URL(
		"/api/auth",
		getServerUrl(env.NEXT_PUBLIC_SERVER_URL),
	).toString(),
	fetchOptions: {
		credentials: "include",
	},
});

/**
 * Inferred types from the auth client for use throughout the app.
 * These types are automatically inferred from the Better Auth configuration.
 *
 * @see https://www.better-auth.com/docs/concepts/typescript#inferring-types
 */
export type Session = typeof authClient.$Infer.Session;
export type User = Session["user"];
