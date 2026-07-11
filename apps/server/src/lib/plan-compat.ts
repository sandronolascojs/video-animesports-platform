// Compat shim for `projects.plan` rows predating the structured
// StyleBibleSpec / keyframe-chain / cinematography upgrade (architecture/
// v2-prompt-craft). Pure + DB-free, same posture as style-bible.ts/
// prompt-builders.ts (see style-bible.ts's doc comment for why).
import type {
	ProjectPlan,
	ProjectPlanCinematography,
	ProjectPlanKeyframe,
} from "@video-platform-challenge/types";
import {
	CameraAngle,
	CameraMotion,
	KEYFRAME_COUNT_OFFSET,
	Pacing,
	ShotScale,
} from "@video-platform-challenge/types";

/**
 * Minimal scene shape this module needs. Kept structural (not importing
 * `SceneRow`) so this file stays free of any DB-adjacent runtime dependency.
 */
export type PlanCompatScene = {
	id: string;
	prompt: string;
};

const FALLBACK_LIGHTING_RULE =
	"Natural lighting consistent with the scene's time of day.";

function isPopulatedKeyframe(
	keyframe: ProjectPlanKeyframe | null | undefined,
): keyframe is ProjectPlanKeyframe {
	return (
		!!keyframe &&
		typeof keyframe.description === "string" &&
		keyframe.description.length > 0
	);
}

function defaultKeyframeFor(
	scene: PlanCompatScene | undefined,
	charactersPresent: string[],
	locationKey: string,
): ProjectPlanKeyframe {
	return {
		description: scene?.prompt ?? "",
		charactersPresent,
		locationKey,
		shotScale: ShotScale.MEDIUM,
		cameraAngle: CameraAngle.EYE_LEVEL,
	};
}

function defaultCinematographyFor(
	scene: PlanCompatScene | undefined,
): ProjectPlanCinematography {
	return {
		cameraMotion: CameraMotion.STATIC,
		motionNotes: scene?.prompt ?? "",
		pacing: Pacing.BUILDING,
	};
}

/**
 * There is no jsonb migration path for `projects.plan` — a pre-upgrade
 * dev-era row simply lacks `styleBibleSpec`/`keyframes`/per-scene
 * `cinematography` at runtime even though `ProjectPlan`'s TS type now
 * declares them required (a `.$type<ProjectPlan>()` column cast is a
 * compile-time assertion only, drizzle never validates jsonb shape at
 * read time). Every reader (generation.service.ts,
 * workflows/video-generation.ts) calls this ONE helper right after loading a
 * plan, then treats the result as always fully structured — no shape
 * branching anywhere else in the pipeline.
 *
 * Missing/malformed pieces are defaulted to a plain, safe rendition of the
 * OLD pre-upgrade behavior (the scene's own `prompt` as the keyframe
 * description/motion notes, a neutral medium/eye-level/static camera)
 * rather than throwing — every downstream builder still runs on the result,
 * so even a legacy plan gets the anime consistency clause + anchor language
 * (a strict improvement over its original prompts, never a regression).
 * `styleBibleSpec` is only defaulted for its `lighting` field (the only
 * field any builder reads directly, via `buildLocationSheetPrompt`) since a
 * legacy project's `projects.styleBible` STRING column already holds its
 * compiled style block as-is and callers keep using that column unchanged
 * for those rows — this default only backstops direct `styleBibleSpec`
 * field access.
 */
export function normalizeProjectPlan(
	plan: ProjectPlan,
	orderedScenes: readonly PlanCompatScene[],
): ProjectPlan {
	const sceneById = new Map(orderedScenes.map((scene) => [scene.id, scene]));
	const sceneCount = orderedScenes.length;
	const keyframeCount = sceneCount + KEYFRAME_COUNT_OFFSET;

	const scenes = plan.scenes.map((meta) => ({
		...meta,
		cinematography:
			meta.cinematography ??
			defaultCinematographyFor(sceneById.get(meta.sceneId)),
	}));
	const sceneMetaBySceneId = new Map(
		scenes.map((meta) => [meta.sceneId, meta]),
	);

	const hasValidLength =
		Array.isArray(plan.keyframes) && plan.keyframes.length === keyframeCount;

	const keyframes: ProjectPlanKeyframe[] = Array.from(
		{ length: keyframeCount },
		(_, zeroBasedIndex) => {
			const existing = hasValidLength
				? plan.keyframes[zeroBasedIndex]
				: undefined;
			if (isPopulatedKeyframe(existing)) {
				return existing;
			}
			// Mirrors the workflow's own 1-based governing-scene mapping
			// (video-generation.ts's runProjectGenerationMode keyframe loop):
			// keyframe index i (1-indexed) is governed by scene
			// min(i, sceneCount) - 1 (0-indexed).
			const oneBasedIndex = zeroBasedIndex + 1;
			const governingIndex = Math.min(oneBasedIndex, sceneCount) - 1;
			const governingScene = orderedScenes[governingIndex];
			const meta = governingScene
				? sceneMetaBySceneId.get(governingScene.id)
				: undefined;
			return defaultKeyframeFor(
				governingScene,
				meta?.characterNames ?? [],
				meta?.locationKey ?? "",
			);
		},
	);

	return {
		...plan,
		styleBibleSpec: plan.styleBibleSpec ?? {
			artDirection: "",
			lineArt: "",
			colorScript: "",
			characterRendering: "",
			lighting: FALLBACK_LIGHTING_RULE,
			cameraGrammar: "",
			filmTexture: "",
			motionLanguage: "",
		},
		scenes,
		keyframes,
	};
}
