import { createGateway, type GatewayProvider } from "@ai-sdk/gateway";
import { env } from "@video-platform-challenge/env/server";
import type { LanguageModel } from "ai";
import { PLAN_AGENT_MODEL } from "./model-ids";

export {
	EVAL_JUDGE_MODEL,
	PLAN_AGENT_MODEL,
	STUDIO_AGENT_MODEL,
	TRANSCRIPTION_MODEL,
} from "./model-ids";

/**
 * Builds a fresh AI Gateway client from `env.AI_GATEWAY_API_KEY` — the ONE
 * place every gateway-backed caller in this package gets its client from
 * (`gatewayModel` below for the plan/extend/studio agents, `transcribe.ts`'s
 * `transcribeSpeech` for subtitle STT), so no call site hardcodes a second
 * `createGateway({...})` independently.
 */
export function createAiGateway(): GatewayProvider {
	return createGateway({ apiKey: env.AI_GATEWAY_API_KEY });
}

// Explicit `LanguageModel` return type: `gateway(modelId)`'s inferred type
// references a nested `@ai-sdk/provider` type this package's `declaration`
// output can't otherwise name (TS2883) — the annotation is required for a
// portable `.d.ts`, not just style.
export function gatewayModel(
	modelId: string = PLAN_AGENT_MODEL,
): LanguageModel {
	return createAiGateway()(modelId);
}
