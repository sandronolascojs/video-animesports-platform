// Pure, DB-free (project, scenes) -> tool-result mapping behind the Studio
// agent's `get_project_state` tool (docs ai-architecture-v1.md §8b upgrade)
// — extracted out of agent-chat.service.ts (AI-6c) for bun-testability, same
// DI-core precedent as lib/agent-chat-turn.ts/lib/plan-compat.ts:
// agent-chat.service.ts itself transitively imports
// @video-platform-challenge/db, which resolves `cloudflare:workers` at
// module load and can't be imported under plain `bun test`.
import type {
	ProjectPlanCharacter,
	TimelineEntry,
} from "@video-platform-challenge/types";
import { SceneStatus } from "@video-platform-challenge/types";

// AI-6a §8b upgrade: `get_project_state`'s prior payload only exposed
// title/status/scene id+title+status — the co-director had no story
// visibility (no synopsis, no characters, no dialogue/prompt), so its
// creative suggestions were unguided guesswork. Caps keep the tool's result
// payload lean (studio.agent.ts's own doc comment) even for a long episode.
const TOOL_VISUAL_DESCRIPTION_MAX_LENGTH = 200;
const TOOL_SCENE_PROMPT_MAX_LENGTH = 240;

function truncateForTool(text: string, maxLength: number): string {
	return text.length > maxLength
		? `${text.slice(0, Math.max(0, maxLength - 1))}…`
		: text;
}

/** The subset of `ProjectRow` this module needs — kept as a local shape (not
 * importing the repository's row type) so this file has zero db-adjacent
 * imports, same precedent as `PersistedAgentMessage`/`PlanCompatScene`. */
export interface ProjectStateForToolProject {
	title: string | null;
	synopsis: string | null;
	status: string;
	audioLanguage: string;
	subtitleLanguage: string;
	draftTimeline: TimelineEntry[];
	plan: { characters: ProjectPlanCharacter[] } | null;
}

/** The subset of `SceneRow` this module needs. */
export interface ProjectStateForToolScene {
	id: string;
	title: string | null;
	status: string;
	durationSeconds: number;
	speakerName: string | null;
	dialogue: string | null;
	prompt: string;
	failReason: string | null;
}

export interface ToolProjectCharacter {
	name: string;
	role: string;
	gender: string | undefined;
	visualDescription: string;
}

export interface ToolProjectScene {
	id: string;
	title: string | null;
	status: string;
	durationSeconds: number;
	speakerName: string | null;
	dialogue: string | null;
	prompt: string;
	failReason: string | null;
}

export interface ToolProjectState {
	title: string | null;
	synopsis: string | null;
	status: string;
	audioLanguage: string;
	subtitleLanguage: string;
	characters: ToolProjectCharacter[];
	scenes: ToolProjectScene[];
}

/**
 * `get_project_state`'s real result (docs §8b): full story visibility for
 * the co-director — title/synopsis/status/languages, plan characters
 * (visualDescription capped), and every scene IN TIMELINE ORDER (docs §6:
 * `project.draftTimeline` is the only ordering authority — scene rows carry
 * no sort column) with dialogue/speaker/prompt (capped)/failReason.
 *
 * AI-6c: a scene row that exists but isn't (yet) referenced by the timeline
 * — e.g. a just-inserted extension placeholder mid-workflow — is APPENDED
 * after the timeline-ordered scenes (stable input order) rather than
 * silently dropped, so the co-director's story visibility never has a gap a
 * real scene row is missing from.
 */
export function buildProjectStateForTool(
	project: ProjectStateForToolProject,
	scenes: readonly ProjectStateForToolScene[],
): ToolProjectState {
	const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
	const timelineSceneIds = new Set(
		project.draftTimeline.map((entry) => entry.sceneId),
	);
	const timelineOrderedScenes = project.draftTimeline
		.map((entry) => sceneById.get(entry.sceneId))
		.filter((scene): scene is ProjectStateForToolScene => scene !== undefined);
	const orphanScenes = scenes.filter(
		(scene) => !timelineSceneIds.has(scene.id),
	);
	const orderedScenes = [...timelineOrderedScenes, ...orphanScenes];

	return {
		audioLanguage: project.audioLanguage,
		characters: (project.plan?.characters ?? []).map((character) => ({
			gender: character.gender,
			name: character.name,
			role: character.role,
			visualDescription: truncateForTool(
				character.visualDescription,
				TOOL_VISUAL_DESCRIPTION_MAX_LENGTH,
			),
		})),
		scenes: orderedScenes.map((scene) => ({
			dialogue: scene.dialogue,
			durationSeconds: scene.durationSeconds,
			failReason: scene.status === SceneStatus.FAILED ? scene.failReason : null,
			id: scene.id,
			prompt: truncateForTool(scene.prompt, TOOL_SCENE_PROMPT_MAX_LENGTH),
			speakerName: scene.speakerName,
			status: scene.status,
			title: scene.title,
		})),
		status: project.status,
		subtitleLanguage: project.subtitleLanguage,
		synopsis: project.synopsis,
		title: project.title,
	};
}
