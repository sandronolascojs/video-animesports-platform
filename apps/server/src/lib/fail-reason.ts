// Pure, DB-free logic extracted out of generation.service.ts (fix-pass C3 /
// TESTS) so it's unit-testable under plain `bun:test` without pulling in
// `cloudflare:workers` via `@video-platform-challenge/db`. See
// lib/timeline.ts's file-level comment for why this split exists.

/**
 * Builds a scene/project-safe fail_reason — a static, already
 * user-appropriate base message plus the kie failCode as a short suffix for
 * support/debugging correlation. The full kie `failMsg` (which can echo
 * provider-internal detail) is deliberately NEVER included here — it only
 * ever lands in `generation_tasks.fail_msg` (server-side only, never
 * returned by any contract schema).
 */
export function formatFailReason(base: string, failCode?: string): string {
	return failCode ? `${base} (kie ${failCode})` : base;
}
