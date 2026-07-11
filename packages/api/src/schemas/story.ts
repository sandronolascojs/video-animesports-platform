import {
	CameraAngle,
	CameraMotion,
	CharacterGender,
	INITIAL_SCENE_COUNT,
	KEYFRAME_COUNT_OFFSET,
	MAX_SCENE_DURATION_SECONDS,
	MIN_SCENE_DURATION_SECONDS,
	Pacing,
	ShotScale,
} from "@video-platform-challenge/types";
import z from "zod";

/**
 * The plan agent's structured output (docs §7, architecture/v2-prompt-craft).
 * Lives in packages/api because it's contract — the web app eventually
 * renders the plan (storyboard), the server generates it via `ai@7`'s
 * `generateText({ output: Output.object({ schema: storyPlanSchema }) })`.
 * Every bound here is a deterministic guard: the schema IS the guardrail
 * (docs §7), not prompt luck.
 */
export const storyPlanCharacterSchema = z.object({
	name: z.string().min(1).max(80),
	role: z.string().min(1).max(120),
	// Voice-casting axis (docs §5b): picks the ElevenLabs pool this
	// character's fixed voice is drawn from.
	gender: z.enum([...Object.values(CharacterGender)]),
	// The pixel-anchor prompt used to generate this character's sheet image —
	// kept independent of `role` so the agent can separate "who they are in
	// the story" from "what they look like" (docs §2 coherence mechanism).
	visualDescription: z.string().min(1).max(600),
});

export const storyPlanLocationSchema = z.object({
	// Stable slug scenes reference (docs §6 `scenes.locationKey`, stored in
	// `projects.plan.scenes[].locationKey` in this schema version).
	key: z.string().min(1).max(60),
	name: z.string().min(1).max(120),
	// The location bible: stadium architecture, crowd colors, ad-board text,
	// grass pattern, lighting — prepended to every keyframe prompt for scenes
	// in this location (docs §2).
	description: z.string().min(1).max(600),
	timeOfDay: z.string().min(1).max(60),
});

// --- v2 prompt-craft: structured StyleBibleSpec -----------------------------
// Replaces the old free-string `styleBible` the agent used to write directly.
// The agent now FILLS every field; `apps/server/src/lib/style-bible.ts`'s
// `compileStyleBible` (pure, unit-tested) is the ONE deterministic compiler
// that turns this into the canonical text block prepended to every
// downstream image/video prompt. Field-for-field mirror of
// `packages/types`'s `StyleBibleSpec` (that package has zero deps, no zod —
// this is the validated counterpart).
export const styleBibleSpecSchema = z.object({
	// P0 fix: the plan agent's system prompt (packages/ai's
	// buildPlanSystemPrompt) instructs the model to open this field with the
	// per-template `styleBibleSeed` VERBATIM before adding a sentence of its
	// own — every seed in packages/types/src/templates.ts is already
	// 449-523 chars, so a 400 cap made generation fail on EVERY template
	// before the model added a single word (AI_NoObjectGeneratedError ->
	// PlanGenerationError). 800 covers the longest seed (523) plus the
	// model's added sentence, with headroom.
	artDirection: z.string().min(1).max(800),
	lineArt: z.string().min(1).max(300),
	colorScript: z.string().min(1).max(500),
	characterRendering: z.string().min(1).max(500),
	lighting: z.string().min(1).max(500),
	cameraGrammar: z.string().min(1).max(500),
	filmTexture: z.string().min(1).max(300),
	motionLanguage: z.string().min(1).max(500),
});

// --- v2 prompt-craft: cinematography vocabulary -----------------------------
// Shared-vocabulary rule: these zod enums are built FROM packages/types'
// as-const objects, never redeclared with their own string literals.
export const shotScaleSchema = z.enum([...Object.values(ShotScale)]);
export const cameraAngleSchema = z.enum([...Object.values(CameraAngle)]);
export const cameraMotionSchema = z.enum([...Object.values(CameraMotion)]);
export const pacingSchema = z.enum([...Object.values(Pacing)]);

/**
 * One entry of the keyframe chain (docs §2's fencing mechanism,
 * architecture/v2-prompt-craft). Keyframe i (1-indexed) is the END frame of
 * scene i-1 AND the START frame of scene i — the agent writes this as one
 * continuous visual chain, not per-scene in isolation.
 */
export const storyPlanKeyframeSchema = z.object({
	// Precise visual composition of this frozen frame: who, where, pose,
	// framing — concrete and pixel-anchorable, it seeds an image model.
	description: z.string().min(1).max(600),
	// Must reference names from `storyPlanSchema.characters` — same
	// same-payload cross-reference caveat as `storyPlanSceneSchema.characterNames`
	// (zod can't check it; the caller validates after parsing).
	charactersPresent: z.array(z.string().min(1)).max(6),
	// Must reference a `storyPlanLocationSchema.key`.
	locationKey: z.string().min(1),
	shotScale: shotScaleSchema,
	cameraAngle: cameraAngleSchema,
});

/** Per-scene camera direction — vary shot scale/angle/motion across scenes
 * like a real episode edit, not three identical medium shots (docs
 * architecture/v2-prompt-craft plan-agent instructions). */
export const storyPlanCinematographySchema = z.object({
	cameraMotion: cameraMotionSchema,
	// Anime-timing description of the action beats (impacts, holds, smears,
	// speed lines) — feeds Seedance's motion prompt directly.
	motionNotes: z.string().min(1).max(400),
	pacing: pacingSchema,
});

export const storyPlanSceneSchema = z.object({
	title: z.string().min(1).max(120),
	prompt: z.string().min(1).max(1000),
	// Audio-language spoken line (docs §5b) — audioLanguage drives this.
	// Length is agent-fitted to `durationSeconds` at ~DIALOGUE_WORDS_PER_SECOND
	// (a system-prompt guidance budget, not a hard zod bound — see
	// packages/types' DIALOGUE_WORDS_PER_SECOND doc comment).
	dialogue: z.string().max(500),
	// Subtitle-language caption text (docs §5b) — subtitleLanguage drives
	// this; independent of `dialogue`'s language.
	subtitleText: z.string().max(500),
	// The ONE character (by `characters[].name`) delivering `dialogue` —
	// null when the scene is silent. Drives the fixed per-character voice.
	speaker: z.string().min(1).max(80).nullable(),
	durationSeconds: z
		.number()
		.int()
		.min(MIN_SCENE_DURATION_SECONDS)
		.max(MAX_SCENE_DURATION_SECONDS),
	// Must reference names from `storyPlanSchema.characters` /
	// `storyPlanLocationSchema.key` — zod can't check that cross-reference
	// (it's a same-payload existence check), so the caller validates it
	// after parsing.
	characterNames: z.array(z.string().min(1)).max(6),
	locationKey: z.string().min(1),
	cinematography: storyPlanCinematographySchema,
});

/**
 * The plan schema is a FACTORY over the requested scene count (composer's
 * scenes dropdown, MIN..MAX_SCENES_PER_GENERATION): the exact scene count
 * and the exact N+1 keyframe-chain count stay hard zod bounds (docs §7 "the
 * schema IS the guardrail"), they're just parameterized now.
 */
export const buildStoryPlanSchema = (sceneCount: number) =>
	z.object({
		title: z.string().min(1).max(120),
		synopsis: z.string().min(1).max(1000),
		styleBibleSpec: styleBibleSpecSchema,
		characters: z.array(storyPlanCharacterSchema).min(1).max(10),
		locations: z.array(storyPlanLocationSchema).min(1).max(6),
		scenes: z.array(storyPlanSceneSchema).length(sceneCount),
		// The keyframe chain: EXACTLY sceneCount + KEYFRAME_COUNT_OFFSET
		// entries (K1..KN+1) — docs §2's fencing math.
		keyframes: z
			.array(storyPlanKeyframeSchema)
			.length(sceneCount + KEYFRAME_COUNT_OFFSET),
	});

/** Default-shape instance (INITIAL_SCENE_COUNT) — the `StoryPlan` type
 * derives from this; runtime callers use `buildStoryPlanSchema(n)`. */
export const storyPlanSchema = buildStoryPlanSchema(INITIAL_SCENE_COUNT);

/**
 * Extensions add one scene at a time, in-style, given the story-so-far as
 * context (docs §7) — a single new scene PLUS the single new keyframe entry
 * that becomes its end anchor (its START anchor is the existing last
 * keyframe of the story, given to the agent as context; it must chain
 * visually from that, never re-describe it).
 *
 * `newCharacters`/`newLocation` (docs §8d): when the continuation introduces
 * a character or location not already in the story, the agent fully specs
 * it here (same shape as the original story plan) instead of the server
 * fabricating a placeholder from a bare name — see
 * generation.service.ts::runExtensionPlanStep for the consuming side.
 */
export const extendStorySceneSchema = z.object({
	scene: storyPlanSceneSchema,
	keyframe: storyPlanKeyframeSchema,
	newCharacters: z.array(storyPlanCharacterSchema).max(2).optional(),
	newLocation: storyPlanLocationSchema.optional(),
});

// Named `StoryPlanStyleBibleSpec` (not `StyleBibleSpec`) to avoid colliding
// with packages/types' plain-TS `StyleBibleSpec` when both are imported in
// the same server file — structurally identical, this is the zod-validated
// counterpart used only where the raw agent output is handled directly.
export type StoryPlanStyleBibleSpec = z.infer<typeof styleBibleSpecSchema>;
export type StoryPlanKeyframe = z.infer<typeof storyPlanKeyframeSchema>;
export type StoryPlanCinematography = z.infer<
	typeof storyPlanCinematographySchema
>;
export type StoryPlanCharacter = z.infer<typeof storyPlanCharacterSchema>;
export type StoryPlanLocation = z.infer<typeof storyPlanLocationSchema>;
export type StoryPlanScene = z.infer<typeof storyPlanSceneSchema>;
export type StoryPlan = z.infer<typeof storyPlanSchema>;
export type ExtendStoryScene = z.infer<typeof extendStorySceneSchema>;
