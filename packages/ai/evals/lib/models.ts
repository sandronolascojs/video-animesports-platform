// Eval-side gateway clients (phase AI-6b). Evals build their OWN gateway
// client from process.env — src/models.ts's `gatewayModel` reads env via
// `@video-platform-challenge/env/server`, which re-exports
// `cloudflare:workers` and cannot load under node/vitest. Model ids come
// from src/model-ids.ts (pure constants, no env import).
//
// Tracing: evalite 0.19's own `traceAISDKModel` (evalite/ai-sdk) is built
// for AI SDK 5 / provider-v2 models, where `usage.inputTokens` is a NUMBER.
// Under this repo's ai@7 / provider-v3 models `usage.inputTokens` is an
// OBJECT ({ total, noCache, cacheRead, cacheWrite }) — traceAISDKModel
// passes it through to evalite's sqlite trace insert, which crashes the run
// ("SQLite3 can only bind numbers..."). `tracedEvalModel` below is the same
// idea implemented against the v3 usage shape, reporting through evalite's
// public `reportTrace` API.
import { createGateway } from "@ai-sdk/gateway";
import type { LanguageModel } from "ai";
import { wrapLanguageModel } from "ai";
import { reportTrace, shouldReportTrace } from "evalite/traces";
import { EVAL_JUDGE_MODEL } from "../../src/model-ids";

export function requireGatewayKey(): string {
	const key = process.env.AI_GATEWAY_API_KEY;
	if (!key) {
		throw new Error(
			"AI_GATEWAY_API_KEY is missing. Evals load it from apps/server/.env (see evals/setup.ts) or the shell environment — set it there and re-run `bun run eval`.",
		);
	}
	return key;
}

/** Provider-v3 token counts are `{ total, noCache, ... }` objects; v2 (and
 * some providers) still report plain numbers. Normalize both to a number. */
function tokenCount(value: unknown): number {
	if (typeof value === "number") {
		return value;
	}
	if (typeof value === "object" && value !== null && "total" in value) {
		const total = (value as { total?: unknown }).total;
		return typeof total === "number" ? total : 0;
	}
	return 0;
}

/**
 * Gateway model for the eval TASK (the agent under test), wrapped in a
 * tracing middleware so every call shows up in the evalite UI with token
 * usage. No-op passthrough outside an evalite run.
 */
export function tracedEvalModel(modelId: string): LanguageModel {
	const gateway = createGateway({ apiKey: requireGatewayKey() });
	const model = gateway(modelId);
	if (!shouldReportTrace()) {
		return model;
	}
	return wrapLanguageModel({
		model,
		middleware: {
			wrapGenerate: async ({ doGenerate, params }) => {
				const start = performance.now();
				const generated = await doGenerate();
				const end = performance.now();
				const content = generated.content as Array<{
					type: string;
					text?: string;
					toolName?: string;
					input?: unknown;
					toolCallId?: string;
				}>;
				const text = content
					.filter((part) => part.type === "text")
					.map((part) => part.text ?? "")
					.join("");
				const toolCalls = content
					.filter((part) => part.type === "tool-call")
					.map((part) => ({
						toolName: part.toolName,
						input: part.input,
						toolCallId: part.toolCallId,
					}));
				const usage = generated.usage as
					| { inputTokens?: unknown; outputTokens?: unknown }
					| undefined;
				const inputTokens = tokenCount(usage?.inputTokens);
				const outputTokens = tokenCount(usage?.outputTokens);
				reportTrace({
					input: params.prompt,
					output: toolCalls.length > 0 ? { text, toolCalls } : { text },
					usage: {
						inputTokens,
						outputTokens,
						totalTokens: inputTokens + outputTokens,
					},
					start,
					end,
				});
				return generated;
			},
		},
	});
}

/** Judge model (scorer-side LLM calls) — deliberately UNtraced so the task's
 * trace timeline shows only the agent under test, and deliberately a
 * DIFFERENT model family (openai) than the plan/extend generator
 * (anthropic) to avoid same-model self-preference bias. */
export function judgeModel(): LanguageModel {
	const gateway = createGateway({ apiKey: requireGatewayKey() });
	return gateway(EVAL_JUDGE_MODEL);
}
