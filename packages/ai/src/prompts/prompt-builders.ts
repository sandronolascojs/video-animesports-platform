// Deterministic prompt compilers (docs architecture/v2-prompt-craft §3): the
// LLM writes the FULL structured art direction + cinematography once (plan
// agent, plan.service.ts); everything from here down is pure string
// assembly, no model calls, no randomness. Pure + DB-free, mirrors
// style-bible.ts's own doc comment on why (bun:test needs to import these
// directly without pulling in cloudflare:workers).
import type {
	CameraAngle,
	CameraMotion,
	Pacing,
	ProjectPlanCharacter,
	ProjectPlanCinematography,
	ProjectPlanKeyframe,
	ProjectPlanLocation,
	ShotScale,
} from "@video-platform-challenge/types";

// --- camera-language compilers ---------------------------------------------
// Enum -> English phrase. `Record<Enum, string>` is exhaustive by
// construction: adding a member to packages/types' ShotScale/CameraAngle/
// CameraMotion/Pacing without extending the matching map here is a
// compile-time error, not a silent runtime gap.

const SHOT_SCALE_LANGUAGE: Record<ShotScale, string> = {
	"extreme-wide":
		"extreme wide shot, tiny figures against a vast establishing background",
	wide: "wide shot, full bodies and surrounding environment in frame",
	medium: "medium shot, waist-up framing",
	"close-up": "close-up, head-and-shoulders framing, expressive facial detail",
	"extreme-close-up":
		"extreme close-up, eyes or hands or a key detail fills the frame",
};

const CAMERA_ANGLE_LANGUAGE: Record<CameraAngle, string> = {
	"eye-level": "eye-level angle, neutral perspective",
	"low-angle": "low angle looking up, heroic and imposing perspective",
	"high-angle": "high angle looking down, vulnerable and overview perspective",
	dutch: "dutch tilt, canted horizon for tension",
	"over-the-shoulder": "over-the-shoulder framing",
};

const CAMERA_MOTION_LANGUAGE: Record<CameraMotion, string> = {
	static: "static camera, locked-off frame",
	"pan-left": "camera pans left",
	"pan-right": "camera pans right",
	"push-in": "camera pushes in, slow dolly toward the subject",
	"pull-back": "camera pulls back, dolly away revealing the wider scene",
	tracking: "tracking shot, camera moves alongside the action",
	"crane-up": "crane shot rising upward",
	handheld: "handheld camera, slight natural shake",
};

const PACING_LANGUAGE: Record<Pacing, string> = {
	"slow-burn": "slow-burn pacing, held beats and lingering reactions",
	building: "building pacing, escalating tempo toward the beat",
	frantic: "frantic pacing, rapid cuts-in-motion energy, quick sharp impacts",
};

export function compileShotScale(shotScale: ShotScale): string {
	return SHOT_SCALE_LANGUAGE[shotScale];
}

export function compileCameraAngle(cameraAngle: CameraAngle): string {
	return CAMERA_ANGLE_LANGUAGE[cameraAngle];
}

export function compileCameraMotion(cameraMotion: CameraMotion): string {
	return CAMERA_MOTION_LANGUAGE[cameraMotion];
}

export function compilePacing(pacing: Pacing): string {
	return PACING_LANGUAGE[pacing];
}

// --- length safety net ------------------------------------------------------

/**
 * kie.ai does not publish an exact prompt character cap for
 * gpt-image-2-{text,image}-to-image or bytedance/seedance-2-mini (verified:
 * no such limit in packages/kie/src/client.ts or
 * docs/video-engine-architecture.md §3) — this is a defensive, generous
 * safety net, not a confirmed provider requirement. It is NOT guaranteed to
 * be enough headroom: a fully-maxed-out compiled style block (every
 * StyleBibleSpec field at its zod max) plus a fully-maxed keyframe prompt
 * (max-length description/location, a full 6-name cast, and — worst case —
 * several sheetless-character visualDescription fallbacks at 600 chars each)
 * CAN exceed this cap; the same is true of a fully-maxed scene video prompt.
 * That's fine BY DESIGN: `joinPromptSections`' priority-ordered trailing
 * drop is exactly the mechanism that degrades a pathological input
 * gracefully instead of failing the provider call outright — see each
 * builder's own section-order comment for what survives an overflow first.
 */
export const MAX_COMPILED_PROMPT_LENGTH = 6000;

/**
 * Joins prompt sections in priority order (highest priority first), dropping
 * the lowest-priority TRAILING sections if the joined result would exceed
 * `maxLength`. Callers order sections so the style block / consistency
 * anchor / core subject description come first (never dropped in practice —
 * they're what the whole coherence mechanism depends on) and per-shot
 * flourish (motion notes, extra texture lines) comes last, so that's what a
 * pathologically long input sacrifices first. Falsy sections are skipped.
 */
export function joinPromptSections(
	sections: Array<string | false | null | undefined>,
	maxLength = MAX_COMPILED_PROMPT_LENGTH,
): string {
	const kept: string[] = [];
	let total = 0;
	for (const section of sections) {
		if (!section) {
			continue;
		}
		const addition = (kept.length > 0 ? 1 : 0) + section.length;
		if (total + addition > maxLength) {
			break;
		}
		kept.push(section);
		total += addition;
	}
	return kept.join("\n");
}

// --- prompt builders ---------------------------------------------------------

/**
 * Character model sheet — the pixel anchor every keyframe references (docs
 * §2). `styleBlock` is `compileStyleBible`'s output, already carrying the
 * hard consistency clause.
 */
export function buildCharacterSheetPrompt(
	styleBlock: string,
	character: ProjectPlanCharacter,
): string {
	return joinPromptSections([
		styleBlock,
		"",
		"Anime character reference sheet on a plain flat pale-gray background: one full-body standing pose, front-facing, arms relaxed at the sides, feet visible, plus a larger bust close-up of the same character's face beside it. Flat cel shading, crisp keylines, the complete costume and full color palette clearly readable. No background art, no props unless worn as part of the costume, no text or labels of any kind.",
		character.visualDescription,
		`This sheet is the canonical, binding design for ${character.name} across the entire episode: exact face, exact hair, exact outfit, exact colors in every later shot.`,
	]);
}

/**
 * Location establishing-shot sheet. `lightingRule` is the compiled style
 * spec's `lighting` field text (or the compat fallback for pre-upgrade plans
 * — see lib/plan-compat.ts) — called out explicitly alongside `timeOfDay` per
 * design, even though the style block already carries it, because the
 * time-of-day pairing is location-specific.
 */
export function buildLocationSheetPrompt(
	styleBlock: string,
	location: ProjectPlanLocation,
	lightingRule: string,
): string {
	return joinPromptSections([
		styleBlock,
		"",
		"Anime background art: a clean establishing shot of the location, painted-background layout quality, completely empty of people and animals. Strong perspective lines, clear silhouettes of the key landmarks, composition readable at a glance. No characters, no text, no signage lettering.",
		location.description,
		`Time of day: ${location.timeOfDay}. Lighting: ${lightingRule}`,
	]);
}

/** The hard consistency/no-restyle anchor (docs §2's coherence mechanism) —
 * pulled out to a named constant so its position in `buildKeyframePrompt`'s
 * section list (see priority-order comment there) is visibly deliberate. */
const KEYFRAME_CONSISTENCY_CLAUSE =
	"Cinematic still frame from the episode — one frozen instant, crisp and on-model. Match EXACTLY the art style, character designs, faces, proportions, palette and line weight of the reference images: they are the binding model sheets for this episode. Do not reinterpret, do not restyle, do not change outfits, hairstyles or faces. No text, no watermarks.";

/** A character present in a keyframe whose reference sheet the caller
 * couldn't resolve (docs §8d MEDIUM: "no textual fallback for missing
 * character sheets"). Only the two fields the fallback text needs. */
export type SheetlessCharacter = Pick<
	ProjectPlanCharacter,
	"name" | "visualDescription"
>;

/**
 * One keyframe of the fencing chain (docs §2). `locationDescription` is the
 * owning location's bible text (looked up by `keyframe.locationKey`),
 * undefined if the location can't be resolved (skipped, not fatal — mirrors
 * `buildKeyframeInputUrls`'s "missing ref degrades quality, doesn't block"
 * posture). `sheetlessCharacters` (docs §8d MEDIUM) — the subset of
 * `keyframe.charactersPresent` whose sheet URL the caller couldn't resolve
 * (generation.service.ts's `buildKeyframeInputUrls` silently skips a missing
 * sheet rather than failing) — their `visualDescription` is appended as a
 * textual fallback so those characters aren't rendered with zero design
 * anchor at all.
 *
 * Priority order (highest first — `joinPromptSections` drops the lowest-
 * priority TRAILING sections first on overflow, see that function's doc
 * comment): style block > the hard consistency clause (moved directly after
 * the style block — it used to sit LAST and was the first thing an
 * overflowing prompt lost) > camera/frame (what this image actually shows) >
 * location > cast listing > sheetless-character fallback text (lowest
 * priority — a quality lever for an already-degraded case, not core
 * content).
 */
export function buildKeyframePrompt(
	styleBlock: string,
	keyframe: ProjectPlanKeyframe,
	locationDescription: string | undefined,
	sheetlessCharacters: SheetlessCharacter[] = [],
): string {
	return joinPromptSections([
		styleBlock,
		"",
		KEYFRAME_CONSISTENCY_CLAUSE,
		`Camera: ${compileShotScale(keyframe.shotScale)}, ${compileCameraAngle(keyframe.cameraAngle)}.`,
		`Frame: ${keyframe.description}`,
		locationDescription ? `Location: ${locationDescription}` : undefined,
		keyframe.charactersPresent.length > 0
			? `Characters in frame: ${keyframe.charactersPresent.join(", ")}.`
			: "No characters in frame.",
		sheetlessCharacters.length > 0
			? `No reference sheet is available yet for: ${sheetlessCharacters
					.map(
						(character) => `${character.name} (${character.visualDescription})`,
					)
					.join(
						"; ",
					)} — use this description as their binding design instead of a reference image.`
			: undefined,
	]);
}

/**
 * The Seedance video prompt for one scene. `scenePrompt` is the scene's own
 * `prompt` field (the action beat); `firstFrameUrl`/`lastFrameUrl` (the
 * fencing anchors) are passed as separate kie.ai parameters, not text — this
 * only builds the `prompt` string.
 *
 * `dialogue` (docs studio-fixes-backlog.md): Seedance speaks
 * dialogue natively — every scene video call passes `generate_audio: true`,
 * so the spoken-dialogue clause is inserted whenever there IS dialogue,
 * telling Seedance to voice the line itself in the scene. `speakerName`, if
 * given, is folded into the clause purely for clarity (e.g. "the character
 * (Kaito) speaks...") — it does not change generation behavior.
 *
 * Priority order (see `buildKeyframePrompt`'s doc comment for the same
 * rule): style block > the hard no-morphing/on-model consistency clause
 * (moved directly after the style block — it used to sit LAST) > camera
 * motion/pacing > the action beat > dialogue > motion notes (lowest
 * priority — per-shot flourish).
 */
export function buildSceneVideoPrompt(
	styleBlock: string,
	cinematography: ProjectPlanCinematography,
	scenePrompt: string,
	dialogue?: string,
	speakerName?: string | null,
): string {
	const dialogueText = dialogue?.trim();
	const speakerLabel = speakerName?.trim();
	const dialogueClause = dialogueText
		? speakerLabel
			? `Spoken dialogue: the character (${speakerLabel}) speaks these exact words aloud in the scene: "${dialogueText}"`
			: `Spoken dialogue: the character speaks these exact words aloud in the scene: "${dialogueText}"`
		: undefined;
	return joinPromptSections([
		styleBlock,
		"",
		"One single continuous shot: no cuts, no scene changes, no camera switches. The provided first and last frames define the exact character designs, palette and art style — animate the action between them while keeping every character perfectly on-model, never altering design, proportions or style. 2D cel anime motion: crisp keys, impact frames, speed lines where the motion notes call for them. No morphing, no flicker, no style drift, no added text.",
		`Camera motion: ${compileCameraMotion(cinematography.cameraMotion)}. ${compilePacing(cinematography.pacing)}.`,
		`Action: ${scenePrompt}`,
		dialogueClause,
		`Motion notes: ${cinematography.motionNotes}`,
	]);
}
