// Pure decision logic for the "wedged project never reclaims" fix (MAJOR):
// unlike version.service.ts's RENDER_ABANDON_MINUTES-gated reclaim of a
// stuck `rendering` version, a project stuck in `planning`/`generating`
// (e.g. the isolate running its workflow was killed before the run-level
// catch-all ever marked it failed) had no time-based recovery —
// extend/retry both required a terminal status forever, a permanent dead
// end. Extracted here (same testability split as lib/mark-rendered.ts /
// lib/keyframe-reuse.ts) so plain `bun:test` can exercise every branch
// without importing `@video-platform-challenge/db` (which resolves
// `cloudflare:workers` at module load).
export function isProjectReclaimable(args: {
	status: string;
	/** The statuses THIS call site already treats as terminal — extend only
	 * allows READY; retry allows READY or FAILED (retrying a failed
	 * project's scene IS the recovery path). Reclaimability under the
	 * abandon window is evaluated on top of, not instead of, this set. */
	terminalStatuses: readonly string[];
	updatedAt: Date;
	now: Date;
	abandonMinutes: number;
}): boolean {
	if (args.terminalStatuses.includes(args.status)) {
		return true;
	}
	const abandonMs = args.abandonMinutes * 60 * 1000;
	return args.now.getTime() - args.updatedAt.getTime() >= abandonMs;
}
