import { createGateway } from "@ai-sdk/gateway";
import { env } from "@video-platform-challenge/env/server";
import type { LanguageModel } from "ai";
import { PLAN_AGENT_MODEL } from "./model-ids";

export {
	EVAL_JUDGE_MODEL,
	PLAN_AGENT_MODEL,
	STUDIO_AGENT_MODEL,
} from "./model-ids";

// Explicit `LanguageModel` return type: `gateway(modelId)`'s inferred type
// references a nested `@ai-sdk/provider` type this package's `declaration`
// output can't otherwise name (TS2883) — the annotation is required for a
// portable `.d.ts`, not just style.
export function gatewayModel(
	modelId: string = PLAN_AGENT_MODEL,
): LanguageModel {
	const gateway = createGateway({ apiKey: env.AI_GATEWAY_API_KEY });
	return gateway(modelId);
}
