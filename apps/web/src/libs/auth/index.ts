/**
 * Better Auth exports for the frontend application.
 *
 * This module provides a centralized export point for all authentication-related
 * functionality, following Better Auth best practices.
 *
 * Client-safe exports only — server functions must be imported directly from
 * '@/lib/auth/server' to prevent next/headers from leaking into client bundles.
 *
 * @see https://www.better-auth.com/docs
 */

// Type exports
export type {
	Session,
	Session as AuthSession,
	User,
	User as AuthUser,
} from "./client";
// Client exports (for React components)
export { authClient } from "./client";
