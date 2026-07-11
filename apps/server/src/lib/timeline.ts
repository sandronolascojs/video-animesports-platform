// Pure, DB-free logic extracted out of project.service.ts (fix-pass B1 /
// TESTS) specifically so it's unit-testable under plain `bun:test` —
// project.service.ts (and every other service/repository in this app)
// transitively imports `@video-platform-challenge/db`, which imports
// `cloudflare:workers` at module load time and cannot be imported outside
// the Workers runtime. This file imports NOTHING from db/env/kie/storage,
// so it's safe to import directly in tests.

/**
 * Computes the set-difference between a project's current scene ids and a
 * submitted `updateDraftTimeline` request's scene ids — the submitted set
 * must be EXACTLY the project's scene ids: no missing scene, no
 * unknown/foreign scene id, no duplicate within the submission. Returns the
 * union of every offending id (missing ∪ unknown ∪ duplicated), or an empty
 * set when the submission is complete.
 */
export function findTimelineCompletenessViolations(
	validSceneIds: ReadonlySet<string>,
	submittedSceneIds: readonly string[],
): Set<string> {
	const submittedSet = new Set(submittedSceneIds);
	const invalid = new Set<string>();

	for (const id of validSceneIds) {
		if (!submittedSet.has(id)) {
			invalid.add(id);
		}
	}

	const seen = new Set<string>();
	for (const id of submittedSceneIds) {
		if (!validSceneIds.has(id) || seen.has(id)) {
			invalid.add(id);
		}
		seen.add(id);
	}

	return invalid;
}
