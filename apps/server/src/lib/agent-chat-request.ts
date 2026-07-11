// Zod boundary schema + body-size bound for `POST /agent/:projectId/chat`
// (AI-6a §8a fixes 5, 6). Pure — no db/env import — so it's directly
// unit-testable and mirrors `generation-webhook.service.ts`'s
// `MAX_WEBHOOK_BODY_BYTES` pattern for the size bound.
import z from "zod";

/** Declared-or-actual body size bound for the chat route (mirrors the kie
 * webhook route's `MAX_WEBHOOK_BODY_BYTES` bound pattern in
 * generation-webhook.service.ts) — a real chat turn's JSON body (a handful of
 * short messages) is nowhere near this; it exists to reject a pathological or
 * abusive payload before it's ever parsed. */
export const MAX_AGENT_CHAT_BODY_BYTES = 128 * 1024;

/** Max messages accepted per turn — the AI SDK's `useChat` sends the WHOLE
 * client-side conversation every request; 50 is generous headroom for a real
 * Studio chat session while still bounding a pathological client payload. */
const MAX_MESSAGES_PER_REQUEST = 50;

/**
 * A light boundary schema, deliberately NOT a full `UIMessage` re-model
 * (docs §8a fix 6): only the shape this route's own logic actually reads
 * (`id`, `role`, `parts`) is validated strictly; everything else a real
 * `UIMessage` carries (e.g. per-part metadata) passes through untouched via
 * `.passthrough()` so `body.messages` stays usable as `UIMessage[]` after a
 * successful parse.
 */
export const agentChatMessageSchema = z
	.object({
		id: z.string(),
		role: z.enum(["user", "assistant"]),
		parts: z.array(z.unknown()),
	})
	.passthrough();

export const agentChatRequestBodySchema = z
	.object({
		messages: z
			.array(agentChatMessageSchema)
			.min(1)
			.max(MAX_MESSAGES_PER_REQUEST),
	})
	.passthrough();

export type AgentChatRequestBody = z.infer<typeof agentChatRequestBodySchema>;
