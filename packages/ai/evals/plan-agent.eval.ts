// Plan-agent eval (phase AI-6b): runs the REAL plan agent path — the exact
// system prompt `buildPlanSystemPrompt` composes (template +
// count-aware beats + duration direction + real-person casting) against the
// exact `buildStoryPlanSchema(sceneCount)` guardrail — the same composition
// apps/server/src/services/plan.service.ts's `callPlanAgent` performs (its
// runtime/cache wrapper is orchestration only: a fresh per-call in-memory
// cache never hits, so a single `runPlanAgent` call is behaviorally
// identical). Model = PLAN_AGENT_MODEL via the eval-local gateway client.
//
// packages/ai must not import packages/api in PRODUCTION code (CLAUDE.md
// dependency table) — evals are the documented dev-only exception: the
// schema IS the contract fixture under test.
import {
	buildStoryPlanSchema,
	type StoryPlan,
} from "@video-platform-challenge/api";
import type {
	AudioLanguage as AudioLanguageValue,
	SubtitleLanguage as SubtitleLanguageValue,
	TemplateKey as TemplateKeyValue,
} from "@video-platform-challenge/types";
import { TemplateKey } from "@video-platform-challenge/types";
import { createScorer, evalite } from "evalite";
import { runPlanAgent } from "../src/agents/plan.agent";
import { PLAN_AGENT_MODEL } from "../src/model-ids";
import { runJudge, SKIPPED } from "./lib/judge";
import { tracedEvalModel } from "./lib/models";
import {
	containsJapaneseScript,
	scoreDialogueBudget,
	scoreDurations,
	scoreKeywordGroups,
	scoreSpeakerValidity,
} from "./lib/plan-metrics";

interface PlanEvalInput {
	brief: string;
	templateKey: TemplateKeyValue;
	sceneCount: number;
	audioLanguage: AudioLanguageValue;
	subtitleLanguage: SubtitleLanguageValue;
}

interface PlanEvalExpected {
	/** Keyword groups that must survive into the plan; `a|b` alternates
	 * allowed per group (see plan-metrics.ts `matchesKeywordGroup`). */
	keywordGroups?: string[];
	/** Real, famous people the brief names — must be cast as THEMSELVES. */
	realPeople?: string[];
	/** Fictional characters the USER named — names must be kept verbatim. */
	userNamedCharacters?: string[];
}

/** Set when generation failed BOTH attempts (mirrors production, where
 * generateStoryPlan throws PlanGenerationError after its single retry).
 * Kept as data instead of a thrown error so the row lands in the score
 * table as zeros-with-reason rather than aborting the whole suite (evalite
 * 0.19 + vitest 4's reporter crashes rendering thrown task errors, losing
 * every row's results). */
interface PlanGenerationFailure {
	generationFailed: true;
	error: string;
}

type PlanEvalOutput = StoryPlan | PlanGenerationFailure;

function isGenerationFailure(
	output: PlanEvalOutput,
): output is PlanGenerationFailure {
	return "generationFailed" in output;
}

/** Every scorer zeroes out a row whose generation failed both attempts —
 * a prompt/schema regression must tank the average, not vanish. */
const GENERATION_FAILED = (output: PlanGenerationFailure) => ({
	score: 0,
	metadata: { generationFailed: true, error: output.error },
});

function describeError(error: unknown): string {
	return error instanceof Error
		? `${error.name}: ${error.message}`
		: String(error);
}

const FIXTURES: Array<{ input: PlanEvalInput; expected: PlanEvalExpected }> = [
	{
		input: {
			brief: "messi bribes the referee",
			templateKey: TemplateKey.SOCCER,
			sceneCount: 3,
			audioLanguage: "en",
			subtitleLanguage: "en",
		},
		expected: {
			realPeople: ["Messi"],
			keywordGroups: ["bribe", "referee"],
		},
	},
	{
		input: {
			brief: "a shy kid wins the big tennis tournament for his sick mom",
			templateKey: TemplateKey.TENNIS,
			sceneCount: 5,
			audioLanguage: "en",
			subtitleLanguage: "en",
		},
		// The sick-mom motivation must stay the emotional spine — checked
		// deterministically here, and by the premise-fidelity judge.
		expected: {
			keywordGroups: ["shy", "mom|mother|mama", "tournament"],
		},
	},
	{
		input: {
			brief:
				'boxer Danny "The Hammer" Ortiz loses his belt in round 1, spends a year in the mountains, wins the rematch',
			templateKey: TemplateKey.BOXING,
			sceneCount: 5,
			audioLanguage: "en",
			subtitleLanguage: "en",
		},
		expected: {
			userNamedCharacters: ["Danny"],
			keywordGroups: ["belt", "rematch"],
		},
	},
	{
		input: {
			brief: "lebron james misses the finals shot and trains all summer alone",
			templateKey: TemplateKey.BASKETBALL,
			sceneCount: 3,
			audioLanguage: "en",
			subtitleLanguage: "en",
		},
		expected: {
			realPeople: ["LeBron"],
		},
	},
	{
		// Spanish brief + Japanese audio: the premise may legitimately be
		// translated, so the keyword groups carry ES/EN/JA stems — any
		// language hit counts. Dialogue must be Japanese (dialogue-language
		// scorer below).
		input: {
			brief: "un arquero que le teme a los penales",
			templateKey: TemplateKey.SOCCER,
			sceneCount: 3,
			audioLanguage: "ja",
			subtitleLanguage: "en",
		},
		expected: {
			keywordGroups: [
				"penal|penalt|ペナルティ|PK",
				"goalkeeper|arquero|keeper|ゴールキーパー|キーパー|守護神",
			],
		},
	},
	{
		// Degenerate three-word brief + the 1-scene edge (single
		// self-contained beat; keyframes = exactly 2).
		input: {
			brief: "volleyball team wins",
			templateKey: TemplateKey.VOLLEYBALL,
			sceneCount: 1,
			audioLanguage: "en",
			subtitleLanguage: "en",
		},
		expected: {
			keywordGroups: ["volleyball", "win|won|victor"],
		},
	},
	{
		// Long-arc edge: 10 scenes, 11 keyframes, escalation-ladder guidance.
		input: {
			brief:
				"two track rivals push each other across a whole season until the national final",
			templateKey: TemplateKey.TRACK,
			sceneCount: 10,
			audioLanguage: "en",
			subtitleLanguage: "en",
		},
		expected: {
			keywordGroups: ["rival", "season", "national|final"],
		},
	},
];

// ---------------------------------------------------------------------------
// Deterministic scorers — all verifiable from the plan object alone
// ---------------------------------------------------------------------------

const durationVariety = createScorer<
	PlanEvalInput,
	PlanEvalOutput,
	PlanEvalExpected
>({
	name: "duration-variety",
	description:
		"Durations are integers within MIN/MAX bounds; episodes of 3+ scenes must use at least 2 distinct values (no metronome pacing).",
	scorer: ({ input, output }) =>
		isGenerationFailure(output)
			? GENERATION_FAILED(output)
			: scoreDurations(
					output.scenes.map((scene) => scene.durationSeconds),
					{ requireVariety: input.sceneCount >= 3 },
				),
});

const dialogueBudget = createScorer<
	PlanEvalInput,
	PlanEvalOutput,
	PlanEvalExpected
>({
	name: "dialogue-budget",
	description:
		"Every spoken line physically fits its scene: words / 2.5wps + 1s of air <= durationSeconds (JA: chars/5 word proxy). Fraction of dialogue scenes that fit.",
	scorer: ({ input, output }) =>
		isGenerationFailure(output)
			? GENERATION_FAILED(output)
			: scoreDialogueBudget(output.scenes, input.audioLanguage),
});

const speakerValidity = createScorer<
	PlanEvalInput,
	PlanEvalOutput,
	PlanEvalExpected
>({
	name: "speaker-validity",
	description:
		"Every scene's speaker is null (silent) or exactly matches a declared character name. Fraction of scenes valid.",
	scorer: ({ output }) =>
		isGenerationFailure(output)
			? GENERATION_FAILED(output)
			: scoreSpeakerValidity(
					output.scenes,
					output.characters.map((character) => character.name),
				),
});

const shotVariety = createScorer<
	PlanEvalInput,
	PlanEvalOutput,
	PlanEvalExpected
>({
	name: "shot-variety",
	description:
		"Keyframes use at least min(3, sceneCount) distinct shot scales — a real episode edit, not a slideshow.",
	scorer: ({ input, output }) => {
		if (isGenerationFailure(output)) {
			return GENERATION_FAILED(output);
		}
		const distinctScales = new Set(
			output.keyframes.map((keyframe) => keyframe.shotScale),
		);
		const required = Math.min(3, input.sceneCount);
		return {
			score: distinctScales.size >= required ? 1 : 0,
			metadata: { shotScales: [...distinctScales], required },
		};
	},
});

const premiseRetention = createScorer<
	PlanEvalInput,
	PlanEvalOutput,
	PlanEvalExpected
>({
	name: "premise-retention",
	description:
		"Every expected keyword group (and every user-named/real person) appears somewhere in the plan JSON. Fraction of groups found.",
	scorer: ({ output, expected }) => {
		if (isGenerationFailure(output)) {
			return GENERATION_FAILED(output);
		}
		const groups = [
			...(expected?.keywordGroups ?? []),
			...(expected?.realPeople ?? []),
			...(expected?.userNamedCharacters ?? []),
		];
		return scoreKeywordGroups(JSON.stringify(output), groups);
	},
});

const dialogueLanguage = createScorer<
	PlanEvalInput,
	PlanEvalOutput,
	PlanEvalExpected
>({
	name: "dialogue-language",
	description:
		"When audioLanguage is ja, every non-empty dialogue line contains Japanese script (hiragana/katakana/kanji). Skipped (neutral 1) for non-ja fixtures.",
	scorer: ({ input, output }) => {
		if (isGenerationFailure(output)) {
			return GENERATION_FAILED(output);
		}
		if (input.audioLanguage !== "ja") {
			return SKIPPED;
		}
		const spoken = output.scenes.filter(
			(scene) => scene.dialogue.trim().length > 0,
		);
		if (spoken.length === 0) {
			return { score: 1, metadata: { skipped: "all scenes silent" } };
		}
		const nonJapanese = spoken
			.filter((scene) => !containsJapaneseScript(scene.dialogue))
			.map((scene) => scene.dialogue);
		return {
			score: nonJapanese.length === 0 ? 1 : 0,
			metadata: { spokenScenes: spoken.length, nonJapanese },
		};
	},
});

// ---------------------------------------------------------------------------
// LLM-judge scorers (model = EVAL_JUDGE_MODEL, a different family than the
// generator — see evals/lib/models.ts)
// ---------------------------------------------------------------------------

function sceneSummaries(plan: StoryPlan): string {
	return plan.scenes
		.map(
			(scene, index) =>
				`${index + 1}. "${scene.title}" (${scene.durationSeconds}s) — ${scene.prompt}\n   dialogue [${scene.speaker ?? "silent"}]: ${scene.dialogue || "(none)"}`,
		)
		.join("\n");
}

const premiseFidelity = createScorer<
	PlanEvalInput,
	PlanEvalOutput,
	PlanEvalExpected
>({
	name: "premise-fidelity",
	description:
		"Judge: is the user's premise the actual SPINE of the episode — specific people/events/hook driving the plot — not normalized into a generic sports episode?",
	scorer: async ({ input, output }) =>
		isGenerationFailure(output)
			? GENERATION_FAILED(output)
			: runJudge({
					criteria: `Is the user's premise the actual SPINE of this episode? The specific people, events, and hook the user named must DRIVE the plot — grade "fail" if the premise was replaced, renamed, or diluted into a generic ${input.templateKey} episode, "weak" if it survives only as set dressing, "good"/"excellent" as it increasingly drives every beat.`,
					material: `User's premise (brief): ${input.brief}\n\nGenerated synopsis: ${output.synopsis}\n\nGenerated scenes:\n${sceneSummaries(output)}`,
				}),
});

const storyCraft = createScorer<
	PlanEvalInput,
	PlanEvalOutput,
	PlanEvalExpected
>({
	name: "story-craft",
	description:
		"Judge: stakes, escalation, payoff, and dialogue quality — appropriate to the scene count.",
	scorer: async ({ input, output }) =>
		isGenerationFailure(output)
			? GENERATION_FAILED(output)
			: runJudge({
					criteria: `Grade the episode's story craft FOR A ${input.sceneCount}-SCENE anime episode: (1) clear stakes established early, (2) escalation across scenes (for 1 scene: a complete self-contained beat), (3) a decisive payoff in the final scene, (4) dialogue that is short, declarative, and charged — TV-anime register, no exposition dumps.`,
					material: `Scene count: ${input.sceneCount}\n\nSynopsis: ${output.synopsis}\n\nScenes:\n${sceneSummaries(output)}`,
				}),
});

const realPersonCasting = createScorer<
	PlanEvalInput,
	PlanEvalOutput,
	PlanEvalExpected
>({
	name: "real-person-casting",
	description:
		"Judge: named real people appear AS THEMSELVES — real name kept, recognizable likeness in visualDescription. Skipped (neutral 1) when the fixture names no real person.",
	scorer: async ({ output, expected }) => {
		if (isGenerationFailure(output)) {
			return GENERATION_FAILED(output);
		}
		if (!expected?.realPeople || expected.realPeople.length === 0) {
			return SKIPPED;
		}
		const characterSheet = output.characters
			.map(
				(character) =>
					`- ${character.name} (${character.role}, ${character.gender}): ${character.visualDescription}`,
			)
			.join("\n");
		return runJudge({
			criteria: `The brief names the real person(s): ${expected.realPeople.join(", ")}. Grade whether each appears in the cast AS THEMSELVES: (1) their real name kept exactly (not renamed, not replaced by an invented character), (2) their "visualDescription" describes their recognizable real-world likeness (build, hair, skin tone, iconic kit/number/traits) translated into anime style. "fail" if renamed/replaced, "weak" if the name survives but the likeness is generic.`,
			material: `Characters:\n${characterSheet}\n\nSynopsis: ${output.synopsis}`,
		});
	},
});

// ---------------------------------------------------------------------------

evalite<PlanEvalInput, PlanEvalOutput, PlanEvalExpected>("plan-agent", {
	data: FIXTURES,
	task: async (input) => {
		// The ONE application-level retry mirrors plan.service.ts's
		// generateStoryPlan: an occasional schema-violating generation gets
		// one fresh attempt before failing the row, same as production. A
		// double failure becomes a zero-scored row (see PlanGenerationFailure).
		const callAgent = () =>
			runPlanAgent({
				model: tracedEvalModel(PLAN_AGENT_MODEL),
				templateKey: input.templateKey,
				sceneCount: input.sceneCount,
				audioLanguage: input.audioLanguage,
				subtitleLanguage: input.subtitleLanguage,
				prompt: input.brief,
				schema: buildStoryPlanSchema(input.sceneCount),
			});
		try {
			const plan = await callAgent().catch(callAgent);
			return plan as PlanEvalOutput;
		} catch (error) {
			return { generationFailed: true, error: describeError(error) };
		}
	},
	scorers: [
		durationVariety,
		dialogueBudget,
		speakerValidity,
		shotVariety,
		premiseRetention,
		dialogueLanguage,
		premiseFidelity,
		storyCraft,
		realPersonCasting,
	],
	columns: async ({ input, output }) => [
		{ label: "Brief", value: input.brief },
		{
			label: "Shape",
			value: `${input.templateKey} · ${input.sceneCount} scenes · ${input.audioLanguage}/${input.subtitleLanguage}`,
		},
		{
			label: "Title",
			value: isGenerationFailure(output)
				? `(generation failed: ${output.error})`
				: output.title,
		},
		{
			label: "Cast",
			value: isGenerationFailure(output)
				? ""
				: output.characters.map((character) => character.name).join(", "),
		},
	],
});
