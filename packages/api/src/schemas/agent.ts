import {
	INITIAL_SCENE_COUNT,
	MAX_SCENES_PER_GENERATION,
	MIN_SCENES_PER_GENERATION,
} from "@video-platform-challenge/types";
import z from "zod";

/**
 * Mirrors the AI SDK `UIMessage["role"]` union exactly — `agent_messages`
 * only ever persists these three roles (docs ai-architecture-v1.md §2,
 * packages/db/src/schema/agent-message.ts). The DB column itself stays plain
 * `text` (storage is loose, verbatim); this contract is the strict boundary.
 */
export const agentMessageRoleSchema = z.enum(["system", "user", "assistant"]);

/**
 * A persisted Studio agent chat turn — `parts` is the AI SDK
 * `UIMessage["parts"]` array stored verbatim (text/tool-call/tool-result
 * parts as streamed), so the sidebar can replay a turn exactly as it
 * rendered live. Left as `z.unknown()` entries deliberately: the AI SDK owns
 * that union's shape, not this contract (see the schema table's own doc
 * comment).
 */
export const agentMessageSchema = z.object({
	id: z.string(),
	role: agentMessageRoleSchema,
	parts: z.array(z.unknown()),
	createdAt: z.date(),
});

export const agentHistoryInputSchema = z.object({
	projectId: z.string(),
});

export const agentHistoryOutputSchema = z.array(agentMessageSchema);

// The sidebar Director composer: a free-text instruction to the studio agent.
export const agentComposerInputSchema = z.object({
	prompt: z.string().trim().min(1).max(2000),
});

// The Studio floating dock: the same instruction plus how many scenes a
// generate-shaped request should add (the dock's scenes dropdown). sceneCount's
// .default() means its input type is optional but its output is a guaranteed
// number — bind form state to the *Form* (input) type, submit handlers get the output.
export const studioDockInputSchema = agentComposerInputSchema.extend({
	sceneCount: z
		.number()
		.int()
		.min(MIN_SCENES_PER_GENERATION)
		.max(MAX_SCENES_PER_GENERATION)
		.default(INITIAL_SCENE_COUNT),
});

export type AgentMessageRole = z.infer<typeof agentMessageRoleSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type AgentHistoryInput = z.infer<typeof agentHistoryInputSchema>;
export type AgentComposerInput = z.infer<typeof agentComposerInputSchema>;
export type StudioDockFormInput = z.input<typeof studioDockInputSchema>;
export type StudioDockInput = z.infer<typeof studioDockInputSchema>;
