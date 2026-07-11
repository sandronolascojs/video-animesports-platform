// The plan agent (docs §7, phase 3b-2; system prompt rewritten for
// architecture/v2-prompt-craft; moved into packages/ai for AI-1 —
// docs/ai-architecture-v1.md §3). Structured output via `ai@7`'s
// `generateText({ output: Output.object({ schema }) })` — `generateObject`
// is deprecated in v7.
//
// packages/ai must not depend on packages/api (dependency table, docs §3):
// the plan schema (`buildStoryPlanSchema`) stays in packages/api — the
// CONTRACT — while the prompt text and agent wiring live here. The caller
// (apps/server's plan.service.ts) passes the schema in as an argument.

import type {
	AudioLanguage,
	SubtitleLanguage,
	TemplateKey,
} from "@video-platform-challenge/types";
import {
	DIALOGUE_WORDS_PER_SECOND,
	KEYFRAME_COUNT_OFFSET,
} from "@video-platform-challenge/types";
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

export interface PlanSystemPromptInput {
	templateKey: TemplateKey;
	sceneCount: number;
	audioLanguage: AudioLanguage;
	subtitleLanguage: SubtitleLanguage;
}

/**
 * §8d(3): the per-template `agentInstructions` used to hardcode a fixed
 * 3-beat "first scene / middle / final scene" structure regardless of the
 * actual `sceneCount` (1-10, composer dropdown bounds) — a 1-scene or
 * 8-scene episode got the same 3-act prescription a 3-scene one did. This
 * generates count-aware beat guidance instead, applied on top of whatever
 * genre-specific stakes/decisive-moment language the template itself still
 * carries.
 */
function buildActStructureGuidance(sceneCount: number): string {
	if (sceneCount === 1) {
		return "This episode is exactly ONE scene: write it as a single self-contained climactic beat — establish the stakes, deliver the action, and land the payoff all inside that one shot. There is no setup scene to lean on.";
	}
	if (sceneCount <= 3) {
		return `This episode has ${sceneCount} scenes: structure the arc as setup, escalation, and payoff — compress or combine those beats as needed to fit exactly ${sceneCount} scene(s), and make the LAST scene the payoff.`;
	}
	return `This episode has ${sceneCount} scenes: build an explicit escalation ladder across them — each scene must raise the stakes higher than the one before it — and include at least one reaction/quiet beat before the climax (a held breath after a setback, a regroup) rather than escalating in a straight line. The LAST scene is always the decisive climax and its emotional release.`;
}

/**
 * The director brief (architecture/v2-prompt-craft): template-agnostic —
 * every genre-specific instruction comes from `template.agentInstructions` /
 * `template.styleBibleSeed`, everything below is the showrunner discipline
 * that applies to ANY template. Demands the FULL structured art direction +
 * cinematography a real anime episode needs, not just a story outline —
 * this is the system prompt the "100% igual a un animé" bar rests on.
 */
export function buildPlanSystemPrompt({
	templateKey,
	sceneCount,
	audioLanguage,
	subtitleLanguage,
}: PlanSystemPromptInput): string {
	const template = TEMPLATES[templateKey];
	const keyframeCount = sceneCount + KEYFRAME_COUNT_OFFSET;
	return [
		"You are the showrunner and director of a single anime episode. Produce the FULL structured art direction, cinematography, and shot chain a real animation studio would need to storyboard this episode — not just a plot outline.",
		// §8d(2): the user's premise is the seed the whole episode grows from —
		// expand it into a full arc, never replace or dilute what they actually
		// asked for.
		"The user's premise is sacred: expand a minimal brief into a full episode with real stakes, motivation, escalation, and payoff — but never replace or dilute the specific people, events, or hook the user named. Only invent names for characters the user did NOT already name.",
		REAL_PERSON_CASTING_DIRECTIVE,
		template.agentInstructions,
		buildActStructureGuidance(sceneCount),
		buildDurationDirectionGuidance(),
		"",
		`Write EXACTLY ${sceneCount} scenes — no more, no fewer.`,
		'Every scene is ONE continuous shot — a single take the video model can stage without cuts: one location, one camera move, one action beat that fits its duration. Never script mid-scene cuts, montages, or "meanwhile" jumps; if the story needs a new angle or place, that is the NEXT scene.',
		"Keep the cast tight: 2-4 named characters total, and never more than 3 characters visible in any single keyframe.",
		"",
		'"styleBibleSpec" — fill EVERY field concretely, no generic filler:',
		`- artDirection: open with this exact seed sentence verbatim, then add 1 more sentence of story-specific texture: "${template.styleBibleSeed}"`,
		"- lineArt: the line weight and ink rules (keyline thickness, cleanup style) — concrete, e.g. thick outer silhouette lines, thinner interior linework.",
		"- colorScript: the master palette and how color behaves — kit/costume colors, skin tones, sky/environment colors, how night vs day scenes shift the palette.",
		"- characterRendering: proportions, eye style, hair rendering, and shading rules (flat cel shading vs soft shading, how many shading tones).",
		"- lighting: key/rim/ambient lighting rules, stated per time-of-day (day/night/golden-hour) — scenes will reference this directly.",
		"- cameraGrammar: the lens language and framing habits of THIS show specifically — e.g. favors low dramatic angles on impact, wide establishing shots between beats.",
		"- filmTexture: grain, bloom, and post-processing texture — how filmic vs clean-digital the image should read.",
		"- motionLanguage: the anime timing rules THIS show uses — impact frames, speed lines, smears, held frames — specific, not generic.",
		"",
		`"keyframes" — write EXACTLY ${keyframeCount} entries, K1 through K${keyframeCount}, in order. This is the keyframe-chain continuity rule: keyframe i is the END frame of scene i-1 AND the START frame of scene i (scene 1 starts on K1 and ends on K2, scene 2 starts on K2 and ends on K3, and so on). Consecutive scenes MUST share their boundary frame — write each keyframe's "description" as the ONE frozen instant both neighboring scenes agree on, never two different descriptions for the same boundary.`,
		'Each keyframe "description" must read as a single FREEZABLE instant — a pose held mid-frame (the ball at boot-contact, a hand at the apex of a jump, eyes locked mid-stare) — never a span of motion ("running past", "as he shoots"). State who is in frame, exactly where, their held pose, and the framing.',
		'Vary "cinematography" (shotScale, cameraAngle, cameraMotion) like a real episode edit — do NOT give every scene the same medium/eye-level/static shot, that reads as a slideshow, not anime. Mix wide establishing beats with close-up reaction beats, static holds with pushes/tracking on action.',
		`"dialogue" is spoken voice ONLY — no narration, no sound-effect words, no stage directions. Fit each line to its scene's "durationSeconds": roughly ${DIALOGUE_WORDS_PER_SECOND} words per second in English, and noticeably shorter phrasing in Japanese — every line must be comfortably speakable inside the scene's duration; when in doubt, cut it shorter. Silence is a valid anime beat: a scene may carry an empty dialogue if the moment plays stronger mute.`,
		`Write every scene's "dialogue" field in ${languageName(audioLanguage)} (the audio/voice language).`,
		`Write every scene's "subtitleText" field in ${languageName(subtitleLanguage)} (the subtitle/caption language) — a translation of the dialogue's meaning, not a transliteration.`,
		'Every scene\'s "characterNames" and every keyframe\'s "charactersPresent" must reference names from the "characters" array you produce; every scene\'s and keyframe\'s "locationKey" must reference a "key" from the "locations" array you produce — never invent a name/key that isn\'t declared in those arrays.',
		'Every character carries a "gender" — "male" or "female" — used to cast that character\'s voice actor; decide it from the story and never leave it ambiguous.',
		'Every scene whose "dialogue" is non-empty names its "speaker": EXACTLY ONE name from your "characters" array — the single character heard saying the line. Silent scenes (empty dialogue) set "speaker" to null. One voice per scene: never write a line that two characters deliver together.',
		'Character "visualDescription"s are binding design specs, not narration: exact hair color and shape, eye color, skin tone, the full outfit with specific color names and kit number, plus 1-2 unmistakable distinguishing marks. Never vague adjectives ("athletic", "handsome") — only drawable facts a character designer could ink without asking questions.',
		"Location descriptions and keyframe descriptions are equally pixel-anchorable: concrete geometry, named colors, weather, and exactly what occupies the frame.",
	].join("\n");
}

export interface RunPlanAgentInput<TSchema extends z.ZodTypeAny>
	extends PlanSystemPromptInput {
	model: LanguageModel;
	/** The story description — the user-authored brief driving generation. */
	prompt: string;
	schema: TSchema;
}

/**
 * Runs the plan agent: builds the system prompt from `input`, calls
 * `generateText` with structured output against the caller-supplied schema
 * (kept in packages/api — see this module's doc comment on the dependency
 * rule), and returns the parsed output.
 */
export async function runPlanAgent<TSchema extends z.ZodTypeAny>(
	input: RunPlanAgentInput<TSchema>,
): Promise<z.infer<TSchema>> {
	const { model, prompt, schema, ...systemInput } = input;
	const result = await generateText({
		model,
		system: buildPlanSystemPrompt(systemInput),
		prompt,
		output: Output.object({ schema }),
	});
	// `Output.object({ schema })` can't narrow `result.output` past `unknown`
	// when `schema` is a generic `TSchema` (not a concrete literal type) — the
	// cast is safe: `generateText` validates the output against `schema` at
	// runtime before returning it.
	return result.output as z.infer<TSchema>;
}
