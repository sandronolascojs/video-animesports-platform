import type {
	AudioLanguage,
	CameraMotion,
	Pacing,
	ShotScale,
	SubtitleLanguage,
	TemplateKey,
} from "@video-platform-challenge/types";
import { DIALOGUE_WORDS_PER_SECOND } from "@video-platform-challenge/types";
import type { LanguageModel } from "ai";
import { generateText, Output } from "ai";
import type { z } from "zod";
import {
	buildDurationDirectionGuidance,
	REAL_PERSON_CASTING_DIRECTIVE,
} from "../prompts/story-direction";
import { TEMPLATES } from "../prompts/templates";

function languageName(code: AudioLanguage | SubtitleLanguage): string {
	return code === "ja" ? "Japanese" : "English";
}

/** The LAST existing scene's camera direction (docs §8d MEDIUM: "extend
 * agent context too thin... add... previous scene's cinematography") — kept
 * as a plain shape (not `ProjectPlanCinematography`) since only `cameraMotion`
 * needs its own type import here; `motionNotes`/`pacing` are free-ish text
 * either way. */
export interface PreviousSceneCinematography {
	cameraMotion: CameraMotion;
	motionNotes: string;
	pacing: Pacing;
	shotScale?: ShotScale;
}

export interface ExtendSystemPromptInput {
	templateKey: TemplateKey;
	audioLanguage: AudioLanguage;
	subtitleLanguage: SubtitleLanguage;
	/** The project synopsis (docs §8d MEDIUM) — grounds the continuation in
	 * the episode's overall arc, not just the immediately prior scenes. */
	synopsis: string;
	/** Compiled style block (docs architecture/v2-prompt-craft — the SAME
	 * text prepended to every image/video prompt for this project). */
	styleBible: string;
	/** The current last keyframe's "description" — the new scene's implicit
	 * START anchor. The agent must chain from this exact frozen frame, never
	 * redescribe it. */
	previousKeyframeDescription: string;
	/** The LAST existing scene's cinematography, when there is a prior scene
	 * (undefined for the very first extension of a project with zero prior
	 * scenes) — grounds "vary cinematography from the previous scene" in an
	 * actual value instead of asking the model to guess. */
	previousSceneCinematography?: PreviousSceneCinematography;
	existingCharacterNames: string[];
	existingLocationKeys: string[];
	/** Story-so-far: prior scenes' prompt/dialogue, in order (docs §7). */
	storySoFar: Array<{ title: string; prompt: string; dialogue: string }>;
	/** Optional user guidance for the new scene. */
	prompt?: string;
}

export function buildExtendSystemPrompt(
	input: ExtendSystemPromptInput,
): string {
	const template = TEMPLATES[input.templateKey];
	return [
		"You are the showrunner and director of an ALREADY-RUNNING anime episode, extending it by exactly ONE new scene that continues it in-style.",
		template.agentInstructions,
		buildDurationDirectionGuidance(),
		"",
		`Produce exactly one new "scene" AND its "keyframe" — the new scene's END anchor. The new scene's START anchor is the CURRENT last keyframe of the story, given below — do NOT redescribe it; the new keyframe's "description" must show only where the story visually moves TO by the end of this new scene, chaining continuously from that exact frozen frame.`,
		'The new scene is ONE continuous shot — a single take with no cuts, one location, one camera move, one action beat that fits its duration. The new keyframe "description" must read as a single FREEZABLE instant (a held pose, not a span of motion), with at most 3 characters in frame.',
		input.synopsis ? `Episode synopsis: ${input.synopsis}` : undefined,
		`Current last keyframe (the new scene's implicit start): ${input.previousKeyframeDescription}`,
		`Write "dialogue" in ${languageName(input.audioLanguage)} and "subtitleText" in ${languageName(input.subtitleLanguage)}.`,
		`Fit "dialogue" to "durationSeconds" at roughly ${DIALOGUE_WORDS_PER_SECOND} words per second — never write a line the scene's duration couldn't physically contain.`,
		input.previousSceneCinematography
			? `The previous scene's cinematography was: cameraMotion=${input.previousSceneCinematography.cameraMotion}, pacing=${input.previousSceneCinematography.pacing}, motion notes: ${input.previousSceneCinematography.motionNotes}. Give THIS scene its own distinct "cinematography" (shotScale, cameraAngle, cameraMotion) that visibly varies from that — do not just repeat the previous scene's shot, vary it like a real episode edit.`
			: 'Give this scene its own distinct "cinematography" (shotScale, cameraAngle, cameraMotion) — vary it like a real episode edit.',
		`This project's compiled style block (reuse the SAME visual style shown here — do not redefine or reinterpret it, do not restyle): ${input.styleBible}`,
		`Existing character names you should reuse via "characterNames"/"charactersPresent" (only invent a new one if the story genuinely needs it): ${input.existingCharacterNames.join(", ") || "(none yet)"}`,
		`Existing location keys you should reuse via "locationKey" (only invent a new one if the scene genuinely happens somewhere new): ${input.existingLocationKeys.join(", ") || "(none yet)"}`,
		'Existing characters already have a fixed "gender" driving their cast voice actor — reuse them via "characterNames" exactly as named, never redescribe or reassign them; only introduce a brand-new character if the user\'s instruction genuinely requires one.',
		// §8d(1): the extend agent previously could only NAME a new character/
		// location via characterNames/locationKey, forcing the server to
		// fabricate a placeholder visualDescription/description — those
		// placeholders then seeded REAL binding character/location sheets,
		// permanently off-design. If this scene needs someone/somewhere new,
		// fully spec it here instead.
		'If this scene\'s action introduces a character not in the existing character list above, add them to "newCharacters" (max 2) fully specified exactly like the original story bible would — name, role, gender, and a binding "visualDescription" (exact hair, eyes, skin tone, full outfit with colors, 1-2 distinguishing marks) — never just a bare name in "characterNames" with nothing behind it. Same for a brand-new location: add it to "newLocation" fully specified (key, name, description, timeOfDay), not just a bare "locationKey".',
		REAL_PERSON_CASTING_DIRECTIVE,
		'If this scene\'s "dialogue" is non-empty, its "speaker" must be EXACTLY ONE name — the single character heard saying the line, drawn from the existing characters or the new one you introduce. A silent scene (empty dialogue) sets "speaker" to null. One voice per scene: never write a line that two characters deliver together.',
		"Story so far, in order:",
		...input.storySoFar.map(
			(scene, index) =>
				`${index + 1}. ${scene.title || "(untitled)"} — ${scene.prompt} | dialogue: ${scene.dialogue || "(none)"}`,
		),
		input.prompt
			? `The user asked for this specific direction for the new scene: ${input.prompt}`
			: "No specific user direction was given — continue the story naturally.",
		"Respond with exactly one new scene + keyframe pair matching the schema.",
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

export interface RunExtendAgentInput<TSchema extends z.ZodTypeAny>
	extends ExtendSystemPromptInput {
	model: LanguageModel;
	schema: TSchema;
}

/**
 * Runs the extend agent: builds the system prompt from `input`, calls
 * `generateText` with structured output against the caller-supplied schema,
 * and returns the parsed output. `prompt` (the generateText user prompt)
 * falls back to a generic continuation instruction when the caller didn't
 * supply one — matching `buildExtendSystemPrompt`'s own optional-prompt
 * handling.
 */
export async function runExtendAgent<TSchema extends z.ZodTypeAny>(
	input: RunExtendAgentInput<TSchema>,
): Promise<z.infer<TSchema>> {
	const { model, schema, ...systemInput } = input;
	const result = await generateText({
		model,
		system: buildExtendSystemPrompt(systemInput),
		prompt: systemInput.prompt ?? "Continue the story with one new scene.",
		output: Output.object({ schema }),
	});
	// See plan.agent.ts's runPlanAgent for why this cast is needed and safe.
	return result.output as z.infer<TSchema>;
}
