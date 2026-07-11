// Extend-agent eval (phase AI-6b): runs the REAL extend agent
// (`runExtendAgent` + `buildExtendSystemPrompt`) against the REAL contract
// schema (`extendStorySceneSchema`) over the story-sofia fixture, whose
// shape mirrors exactly what generation.service.ts's `runExtensionPlanStep`
// composes (synopsis, compiled style bible, last-keyframe anchor, previous
// scene's cinematography, existing names/keys, story-so-far — the AI-6a §8d
// context set). A "sceneCount 2" case runs the agent twice SEQUENTIALLY,
// threading each extension into the next call's context (new storySoFar
// entry, new keyframe anchor, new cinematography, any newCharacters) — the
// same accumulation the production per-scene workflow loop performs.
import {
	type ExtendStoryScene,
	extendStorySceneSchema,
} from "@video-platform-challenge/api";
import { createScorer, evalite } from "evalite";
import {
	type PreviousSceneCinematography,
	runExtendAgent,
} from "../src/agents/extend.agent";
import { PLAN_AGENT_MODEL } from "../src/model-ids";
import { STORY_SOFIA } from "./fixtures/story-sofia";
import { runJudge } from "./lib/judge";
import { tracedEvalModel } from "./lib/models";
import {
	scoreDialogueBudget,
	scoreDurations,
	scoreSpeakerValidity,
} from "./lib/plan-metrics";

interface ExtendEvalInput {
	instruction: string;
	sceneCount: number;
}

interface ExtendEvalExpected {
	/** When set, the continuation MUST introduce this newCharacters entry,
	 * fully specced. When unset, introducing anyone new is a continuity
	 * failure (the instruction is answerable with the existing cast). */
	newCharacterName?: string;
}

interface ExtendEvalOutput {
	extensions: ExtendStoryScene[];
	/** Set when a step failed BOTH attempts (mirrors production, where
	 * generateSceneExtension throws PlanGenerationError after its single
	 * retry). Kept as data instead of a thrown error so the row lands in
	 * the score table as zeros-with-reason rather than aborting the whole
	 * suite (evalite 0.19 + vitest 4's reporter crashes rendering thrown
	 * task errors, losing every row's results). */
	generationError?: string;
}

function describeError(error: unknown): string {
	return error instanceof Error
		? `${error.name}: ${error.message}`
		: String(error);
}

/** Every scorer zeroes out a row whose generation failed both attempts —
 * a prompt/schema regression must tank the average, not vanish. */
const GENERATION_FAILED = (output: ExtendEvalOutput) => ({
	score: 0,
	metadata: {
		generationFailed: true,
		error: output.generationError,
		completedExtensions: output.extensions.length,
	},
});

const CASES: Array<{ input: ExtendEvalInput; expected: ExtendEvalExpected }> = [
	{
		input: {
			instruction: "continue with the rival demanding a rematch in the rain",
			sceneCount: 2,
		},
		// Ren (the rival) already exists — no new character is needed.
		expected: {},
	},
	{
		input: {
			instruction:
				"introduce Sofia, Kaito's older sister, a strict referee who suspects the bribe",
			sceneCount: 2,
		},
		expected: { newCharacterName: "Sofia" },
	},
];

function allNewCharacters(output: ExtendEvalOutput) {
	return output.extensions.flatMap(
		(extension) => extension.newCharacters ?? [],
	);
}

// ---------------------------------------------------------------------------
// Deterministic scorers (duration/dialogue/speaker reuse plan-metrics.ts)
// ---------------------------------------------------------------------------

const durationBounds = createScorer<
	ExtendEvalInput,
	ExtendEvalOutput,
	ExtendEvalExpected
>({
	name: "duration-bounds",
	description:
		"New scenes' durations are integers within MIN/MAX bounds (variety not required across a 2-scene extension).",
	scorer: ({ output }) =>
		output.generationError
			? GENERATION_FAILED(output)
			: scoreDurations(
					output.extensions.map((extension) => extension.scene.durationSeconds),
					{ requireVariety: false },
				),
});

const dialogueBudget = createScorer<
	ExtendEvalInput,
	ExtendEvalOutput,
	ExtendEvalExpected
>({
	name: "dialogue-budget",
	description:
		"Every new spoken line fits its scene's duration (words / 2.5wps + 1s of air).",
	scorer: ({ output }) =>
		output.generationError
			? GENERATION_FAILED(output)
			: scoreDialogueBudget(
					output.extensions.map((extension) => extension.scene),
					STORY_SOFIA.audioLanguage,
				),
});

const speakerValidity = createScorer<
	ExtendEvalInput,
	ExtendEvalOutput,
	ExtendEvalExpected
>({
	name: "speaker-validity",
	description:
		"Every new scene's speaker is null or an existing character — or one the SAME extension batch fully introduced via newCharacters.",
	scorer: ({ output }) => {
		if (output.generationError) {
			return GENERATION_FAILED(output);
		}
		const validNames = [
			...STORY_SOFIA.existingCharacterNames,
			...allNewCharacters(output).map((character) => character.name),
		];
		return scoreSpeakerValidity(
			output.extensions.map((extension) => extension.scene),
			validNames,
		);
	},
});

const newCharacterSpecced = createScorer<
	ExtendEvalInput,
	ExtendEvalOutput,
	ExtendEvalExpected
>({
	name: "new-character-specced",
	description:
		"When the instruction introduces someone new: a fully-specced newCharacters entry (name, non-empty visualDescription, gender) that at least one new scene actually uses. When not: no new characters at all.",
	scorer: ({ output, expected }) => {
		if (output.generationError) {
			return GENERATION_FAILED(output);
		}
		const introduced = allNewCharacters(output);
		if (!expected?.newCharacterName) {
			// Continuity contract: this instruction is answerable with the
			// existing cast — inventing someone is the §8d regression.
			return {
				score: introduced.length === 0 ? 1 : 0,
				metadata: {
					unexpectedNewCharacters: introduced.map(
						(character) => character.name,
					),
				},
			};
		}
		const wanted = expected.newCharacterName.toLowerCase();
		const match = introduced.find((character) =>
			character.name.toLowerCase().includes(wanted),
		);
		if (!match) {
			return {
				score: 0,
				metadata: {
					reason: `no newCharacters entry named ${expected.newCharacterName}`,
					introduced: introduced.map((character) => character.name),
				},
			};
		}
		const fullySpecced =
			match.visualDescription.trim().length > 0 &&
			match.gender.trim().length > 0;
		const usedInScene = output.extensions.some(
			(extension) =>
				extension.scene.characterNames.includes(match.name) ||
				extension.scene.speaker === match.name ||
				extension.scene.prompt.toLowerCase().includes(wanted),
		);
		return {
			score: fullySpecced && usedInScene ? 1 : 0.5,
			metadata: {
				name: match.name,
				gender: match.gender,
				visualDescriptionLength: match.visualDescription.length,
				fullySpecced,
				usedInScene,
			},
		};
	},
});

// ---------------------------------------------------------------------------
// Judge
// ---------------------------------------------------------------------------

const continuationCoherence = createScorer<
	ExtendEvalInput,
	ExtendEvalOutput,
	ExtendEvalExpected
>({
	name: "continuation-coherence",
	description:
		"Judge: do the new scenes chain from scene 3's frozen end-frame, reuse the existing cast correctly, honor the instruction, and keep the story's tone/stakes?",
	scorer: async ({ input, output }) => {
		if (output.generationError) {
			// Skip the (paid) judge call — a failed generation is a 0 either way.
			return GENERATION_FAILED(output);
		}
		const storySoFarText = STORY_SOFIA.storySoFar
			.map(
				(scene, index) =>
					`${index + 1}. "${scene.title}" — ${scene.prompt}\n   dialogue: ${scene.dialogue}`,
			)
			.join("\n");
		const newScenesText = output.extensions
			.map((extension, index) => {
				const newCharacters = (extension.newCharacters ?? [])
					.map(
						(character) =>
							`${character.name} (${character.role}): ${character.visualDescription}`,
					)
					.join("; ");
				return `NEW ${index + 1}. "${extension.scene.title}" (${extension.scene.durationSeconds}s) — ${extension.scene.prompt}\n   dialogue [${extension.scene.speaker ?? "silent"}]: ${extension.scene.dialogue || "(none)"}\n   end keyframe: ${extension.keyframe.description}${newCharacters ? `\n   introduces: ${newCharacters}` : ""}`;
			})
			.join("\n");
		return runJudge({
			criteria: `Grade this ${output.extensions.length}-scene continuation of an existing anime episode: (1) the FIRST new scene must pick up directly from the frozen last frame described below — no time skip that ignores it, no re-staging; (2) existing characters (${STORY_SOFIA.existingCharacterNames.join(", ")}) are reused by their exact names and stay consistent with their established roles; (3) the user's instruction — "${input.instruction}" — visibly drives the new scenes; (4) tone and stakes continue the story rather than resetting it.`,
			material: `Episode synopsis: ${STORY_SOFIA.synopsis}\n\nStory so far:\n${storySoFarText}\n\nCurrent last frame (the continuation's start anchor): ${STORY_SOFIA.previousKeyframeDescription}\n\nContinuation:\n${newScenesText}`,
		});
	},
});

// ---------------------------------------------------------------------------

evalite<ExtendEvalInput, ExtendEvalOutput, ExtendEvalExpected>("extend-agent", {
	data: CASES,
	task: async (input) => {
		const model = tracedEvalModel(PLAN_AGENT_MODEL);
		let characterNames: string[] = [...STORY_SOFIA.existingCharacterNames];
		let locationKeys: string[] = [...STORY_SOFIA.existingLocationKeys];
		let storySoFar = STORY_SOFIA.storySoFar.map((scene) => ({ ...scene }));
		let previousKeyframeDescription: string =
			STORY_SOFIA.previousKeyframeDescription;
		let previousSceneCinematography: PreviousSceneCinematography = {
			...STORY_SOFIA.previousSceneCinematography,
		};
		const extensions: ExtendStoryScene[] = [];

		// One agent call per new scene, threading context forward — exactly
		// how the production workflow consumes a sceneCount-N extend batch
		// (each runExtensionPlanStep re-reads the plan the previous one
		// wrote). The same user instruction rides along on every step, as in
		// production. The ONE application-level retry mirrors
		// plan.service.ts's generateSceneExtension (an occasional
		// schema-violating generation — e.g. a role 2 chars over its 120-char
		// zod max, seen in the first real run — gets one fresh attempt before
		// failing the row, same as production).
		for (let index = 0; index < input.sceneCount; index++) {
			const callAgent = () =>
				runExtendAgent({
					model,
					templateKey: STORY_SOFIA.templateKey,
					audioLanguage: STORY_SOFIA.audioLanguage,
					subtitleLanguage: STORY_SOFIA.subtitleLanguage,
					synopsis: STORY_SOFIA.synopsis,
					styleBible: STORY_SOFIA.styleBible,
					previousKeyframeDescription,
					previousSceneCinematography,
					existingCharacterNames: characterNames,
					existingLocationKeys: locationKeys,
					storySoFar,
					prompt: input.instruction,
					schema: extendStorySceneSchema,
				});
			let extension: ExtendStoryScene;
			try {
				extension = await callAgent().catch(callAgent);
			} catch (error) {
				// Both attempts failed (production's PlanGenerationError case) —
				// surface it as data so the row scores 0 with the reason attached
				// instead of aborting the suite.
				return { extensions, generationError: describeError(error) };
			}
			extensions.push(extension);

			storySoFar = [
				...storySoFar,
				{
					title: extension.scene.title,
					prompt: extension.scene.prompt,
					dialogue: extension.scene.dialogue,
				},
			];
			previousKeyframeDescription = extension.keyframe.description;
			previousSceneCinematography = extension.scene.cinematography;
			characterNames = [
				...characterNames,
				...(extension.newCharacters ?? []).map((character) => character.name),
			];
			if (extension.newLocation) {
				locationKeys = [...locationKeys, extension.newLocation.key];
			}
		}

		return { extensions };
	},
	scorers: [
		durationBounds,
		dialogueBudget,
		speakerValidity,
		newCharacterSpecced,
		continuationCoherence,
	],
	columns: async ({ input, output }) => [
		{ label: "Instruction", value: input.instruction },
		{
			label: "New scenes",
			value:
				output.extensions
					.map((extension) => extension.scene.title)
					.join(" → ") || "(generation failed)",
		},
		{
			label: "New characters",
			value:
				allNewCharacters(output)
					.map((character) => character.name)
					.join(", ") || "(none)",
		},
		{
			label: "Error",
			value: output.generationError ?? "",
		},
	],
});
