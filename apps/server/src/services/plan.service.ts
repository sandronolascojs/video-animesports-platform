// The plan/extendStory agent orchestration (docs §7, phase 3b-2; system
// prompts + agent-call wiring now live in packages/ai —
// docs/ai-architecture-v1.md §3, phase AI-1). This file stays orchestration
// only: builds inputs, calls packages/ai's runtime/agents, validates via the
// packages/api schemas it already imports, maps errors as before.

import type { PreviousSceneCinematography } from "@video-platform-challenge/ai";
import {
	buildExtendSystemPrompt,
	buildGenerationCacheKey,
	buildPlanSystemPrompt,
	createInMemoryCacheStore,
	createProjectRuntime,
	gatewayModel,
	PLAN_AGENT_MODEL,
	runExtendAgent,
	runPlanAgent,
} from "@video-platform-challenge/ai";
import type {
	ExtendStoryScene,
	StoryPlan,
} from "@video-platform-challenge/api";
import {
	buildStoryPlanSchema,
	extendStorySceneSchema,
} from "@video-platform-challenge/api";
import type {
	AudioLanguage,
	SubtitleLanguage,
	TemplateKey,
} from "@video-platform-challenge/types";

export class PlanGenerationError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "PlanGenerationError";
	}
}

export interface GenerateStoryPlanInput {
	description: string;
	templateKey: TemplateKey;
	sceneCount: number;
	audioLanguage: AudioLanguage;
	subtitleLanguage: SubtitleLanguage;
}

async function callPlanAgent(
	input: GenerateStoryPlanInput,
): Promise<StoryPlan> {
	const model = gatewayModel();
	const schema = buildStoryPlanSchema(input.sceneCount);
	// Fresh runtime/cache per call (docs §3 scalability posture: "runtimes are
	// constructed per request/workflow step") — no real per-project id is in
	// scope this early (this agent runs before any project-scoped chat
	// context exists), and a call-scoped cache keeps this a pure structural
	// change: the retry below never observes a stale/cached failure, and
	// nothing persists across separate generateStoryPlan invocations.
	const runtime = createProjectRuntime({
		projectId: "plan-agent",
		cache: createInMemoryCacheStore(),
	});
	return runtime.runAgent<GenerateStoryPlanInput, StoryPlan>(
		{
			name: "plan",
			cacheKey: (args) =>
				buildGenerationCacheKey({
					modelId: PLAN_AGENT_MODEL,
					system: buildPlanSystemPrompt(args),
					prompt: args.description,
					schemaShape: String(args.sceneCount),
				}),
			run: (args) =>
				runPlanAgent({
					model,
					templateKey: args.templateKey,
					sceneCount: args.sceneCount,
					audioLanguage: args.audioLanguage,
					subtitleLanguage: args.subtitleLanguage,
					prompt: args.description,
					schema,
				}),
		},
		input,
	);
}

/**
 * Generates the initial StoryPlan. Deterministic guards: `storyPlanSchema`
 * itself enforces the exact scene count, the exact N+1 keyframe count, and
 * every field bound (the schema IS the guardrail, docs §7) — `Output.object`
 * rejects/retries internally against that schema, and this wraps ONE
 * additional application-level retry on top, so an occasional malformed
 * first generation doesn't immediately fail the whole workflow run.
 */
export async function generateStoryPlan(
	input: GenerateStoryPlanInput,
): Promise<StoryPlan> {
	try {
		return await callPlanAgent(input);
	} catch (firstError) {
		try {
			return await callPlanAgent(input);
		} catch (retryError) {
			// Not necessarily a schema failure — provider auth/network errors
			// land here too; the real cause is chained for logs.
			throw new PlanGenerationError(
				"Story plan generation failed after retry",
				{
					cause: retryError ?? firstError,
				},
			);
		}
	}
}

export interface GenerateSceneExtensionInput {
	templateKey: TemplateKey;
	audioLanguage: AudioLanguage;
	subtitleLanguage: SubtitleLanguage;
	/** The project synopsis (docs §8d MEDIUM: extend agent context too thin —
	 * grounds the continuation in the episode's overall arc). */
	synopsis: string;
	/** Compiled style block (docs architecture/v2-prompt-craft — the SAME
	 * text prepended to every image/video prompt for this project). */
	styleBible: string;
	/** The current last keyframe's "description" — the new scene's implicit
	 * START anchor. The agent must chain from this exact frozen frame, never
	 * redescribe it. */
	previousKeyframeDescription: string;
	/** The LAST existing scene's cinematography, when there is one (docs
	 * §8d MEDIUM). */
	previousSceneCinematography?: PreviousSceneCinematography;
	existingCharacterNames: string[];
	existingLocationKeys: string[];
	/** Story-so-far: prior scenes' prompt/dialogue, in order (docs §7). */
	storySoFar: Array<{ title: string; prompt: string; dialogue: string }>;
	/** Optional user guidance for the new scene. */
	prompt?: string;
}

async function callExtendAgent(
	input: GenerateSceneExtensionInput,
): Promise<ExtendStoryScene> {
	const model = gatewayModel();
	const runtime = createProjectRuntime({
		projectId: "extend-agent",
		cache: createInMemoryCacheStore(),
	});
	return runtime.runAgent<GenerateSceneExtensionInput, ExtendStoryScene>(
		{
			name: "extend",
			cacheKey: (args) =>
				buildGenerationCacheKey({
					modelId: PLAN_AGENT_MODEL,
					system: buildExtendSystemPrompt(args),
					prompt: args.prompt ?? "Continue the story with one new scene.",
					schemaShape: "extend",
				}),
			run: (args) =>
				runExtendAgent({
					model,
					templateKey: args.templateKey,
					audioLanguage: args.audioLanguage,
					subtitleLanguage: args.subtitleLanguage,
					synopsis: args.synopsis,
					styleBible: args.styleBible,
					previousKeyframeDescription: args.previousKeyframeDescription,
					previousSceneCinematography: args.previousSceneCinematography,
					existingCharacterNames: args.existingCharacterNames,
					existingLocationKeys: args.existingLocationKeys,
					storySoFar: args.storySoFar,
					prompt: args.prompt,
					schema: extendStorySceneSchema,
				}),
		},
		input,
	);
}

export async function generateSceneExtension(
	input: GenerateSceneExtensionInput,
): Promise<ExtendStoryScene> {
	try {
		return await callExtendAgent(input);
	} catch (firstError) {
		try {
			return await callExtendAgent(input);
		} catch (retryError) {
			throw new PlanGenerationError(
				"Scene extension generation failed after retry",
				{ cause: retryError ?? firstError },
			);
		}
	}
}
