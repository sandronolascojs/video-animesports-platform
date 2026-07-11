import z from "zod";

/**
 * Shared, reusable oRPC error definitions (`ErrorMapItem` values passed to
 * `.errors({...})`). Every procedure that can fail a given way declares the
 * SAME object from here — never a locally re-typed one — so the code,
 * message, and data shape stay identical everywhere it appears.
 *
 * Codes used across this contract: NOT_FOUND, CONFLICT, RATE_LIMITED,
 * GENERATION_FAILED (all standard/custom oRPC error codes — `ORPCErrorCode`
 * accepts arbitrary strings, not just the common HTTP-status-backed ones),
 * plus one contract-specific code (INVALID_TIMELINE). VALIDATION failures
 * are handled at the zod layer (input schemas), never as a named error here.
 */

// Ownership misses return NOT_FOUND, NEVER FORBIDDEN: a session must never
// learn that a resource exists if it doesn't own it (docs
// /video-engine-architecture.md §5d.6, tenancy rule).
export const notFoundError = {
	message: "The requested resource was not found.",
};

// A mutation was rejected because the resource is not in a state that
// allows it — e.g. render while already rendering, extend while generating
// (docs §5c.1, §9).
export const conflictError = {
	message: "The resource is not in a state that allows this operation.",
};

// kie.ai: 20 createTask/10s, 429 = no queueing (docs §3). Surfaced as-is
// rather than silently retried, so the UI can back off and inform the user.
export const rateLimitedError = {
	status: 429,
	message: "Too many requests. Try again shortly.",
};

// Surfaced when a generation step (plan/keyframe/scene-video) fails
// synchronously — e.g. the plan agent's structured-output call rejects or
// the provider returns a non-retryable rejection (docs §5c.1: "provider-
// rejection errors surface to the user instead of silently dying"). Most
// generation failures are scene-scoped and asynchronous (reflected via
// `scene.status`/`scene.failReason` through polling, not this error) — this
// is only for the synchronous slice of a generation-kicking call.
export const generationFailedError = {
	status: 422,
	message: "Generation failed.",
	data: z.object({
		reason: z.string(),
	}),
};

// `projects.updateDraftTimeline`: entries must reference scenes that
// actually belong to the project — zod can't check this (it's a database
// existence/ownership check), so it's a typed error instead of a validation
// failure (docs §6, §9).
export const invalidTimelineError = {
	status: 400,
	message: "The timeline references scenes that do not belong to this project.",
	data: z.object({
		invalidSceneIds: z.array(z.string()),
	}),
};
