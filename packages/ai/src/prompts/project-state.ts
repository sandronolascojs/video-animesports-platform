// The Studio agent's system-prompt project-state block (phase AI-6b — moved
// here VERBATIM from apps/server/src/services/agent-chat.service.ts's
// `formatProjectState` so the studio tool-routing eval exercises the REAL
// format the production chat endpoint injects, not a re-implementation).
// Pure data-in/text-out: the server maps its ProjectRow/SceneRow rows onto
// `ProjectStateSummary` and the output text is byte-identical to what the
// old row-typed version produced.
//
// Compact by design (studio.agent.ts's doc comment: "keep each tool's result
// payload lean... so pruning has less to compact") — not a full row dump.

export interface ProjectStateSummaryScene {
	id: string;
	title: string | null;
	status: string;
}

export interface ProjectStateSummary {
	title: string | null;
	status: string;
	synopsis: string | null;
	/** In TIMELINE order — the caller owns ordering, this only renders. */
	scenes: ProjectStateSummaryScene[];
}

export function formatProjectState(state: ProjectStateSummary): string {
	const sceneLines =
		state.scenes.length > 0
			? state.scenes
					.map((scene, index) => {
						const label = scene.title ?? `Scene ${index + 1}`;
						return `- [${scene.id}] ${label} — status: ${scene.status}`;
					})
					.join("\n")
			: "(no scenes yet)";

	return [
		"Current project state:",
		`Title: ${state.title ?? "(untitled)"}`,
		`Status: ${state.status}`,
		state.synopsis ? `Synopsis: ${state.synopsis}` : undefined,
		"Scenes:",
		sceneLines,
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}
