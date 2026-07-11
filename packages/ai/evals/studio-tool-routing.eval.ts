// Studio-agent tool-routing eval (phase AI-6b): one REAL single-step
// `generateText` call with the production system prompt — the exact
// [STUDIO_AGENT_SYSTEM_PROMPT, formatProjectState(...)] composition
// apps/server's buildStudioChat assembles (formatProjectState moved into
// packages/ai in this phase precisely so this eval exercises the REAL state
// block) — and the REAL tool DEFINITIONS from studio.agent.ts. The tools
// carry no `execute` (that is their exported contract), so generation stops
// after the first step and `result.toolCalls` is the routing decision under
// test. Model = STUDIO_AGENT_MODEL.
//
// NOTE: gpt-5.6-terra is a reasoning model — `maxOutputTokens` is
// deliberately NOT set (a small cap starves the reasoning budget and
// truncates tool calls).
import { SceneStatus } from "@video-platform-challenge/types";
import { generateText } from "ai";
import { createScorer, evalite } from "evalite";
import type { StudioAgentToolName } from "../src/agents/studio.agent";
import {
	STUDIO_AGENT_SYSTEM_PROMPT,
	studioAgentTools,
} from "../src/agents/studio.agent";
import { STUDIO_AGENT_MODEL } from "../src/model-ids";
import { formatProjectState } from "../src/prompts/project-state";
import { tracedEvalModel } from "./lib/models";

// Opaque cuid2-shaped ids on purpose: the model must resolve "scene 2" from
// the ordered state block (and its failed status), never from semantic hints
// embedded in the id text.
const SCENE_IDS = [
	"hqz3m1x8w2kf5j9p0c4vbn7d",
	"yt6r2w9qms4x8k1zjc3vfhl5",
	"pk7d4n2bqvx9s1m6w3jzr8ct",
] as const;

// 3 scenes, scene 2 failed. Project status "ready" keeps every routing
// intent viable (render/retry/extend are all legitimate asks), so the eval
// grades ROUTING, not policy refusals.
const PROJECT_STATE_BLOCK = formatProjectState({
	title: "The Whistle's Price",
	status: "ready",
	synopsis:
		"In the prefectural cup final, striker Kaito Tsukino faces his rival Ren Kurobane; a dubious penalty puts Kaito's team behind before a stoppage-time equalizer forces a replay.",
	scenes: [
		{
			id: SCENE_IDS[0],
			title: "Final Under Floodlights",
			status: SceneStatus.VIDEO_READY,
		},
		{
			id: SCENE_IDS[1],
			title: "The Bought Whistle",
			status: SceneStatus.FAILED,
		},
		{
			id: SCENE_IDS[2],
			title: "Equalizer at the Death",
			status: SceneStatus.VIDEO_READY,
		},
	],
});

const MUTATING_TOOLS: StudioAgentToolName[] = [
	"extend_scenes",
	"retry_scene",
	"render_version",
	"update_languages",
];

interface RoutingEvalInput {
	message: string;
}

interface RoutingExpectation {
	/** The tool the message must route to. Unset = no mutating tool expected. */
	tool?: StudioAgentToolName;
	/** Argument subset the matched call must carry (deep-equal per key). */
	args?: Record<string, unknown>;
	/** A plain-text answer (no tool at all) is fully acceptable. */
	allowNoTool?: boolean;
	/** A read-only get_project_state call is fully acceptable. */
	allowReadOnly?: boolean;
}

interface RoutingEvalOutput {
	toolCalls: Array<{ toolName: string; input: unknown }>;
	text: string;
}

const CASES: Array<{
	input: RoutingEvalInput;
	expected: RoutingExpectation;
}> = [
	{
		input: { message: "add two more scenes where they win the final" },
		expected: { tool: "extend_scenes", args: { sceneCount: 2 } },
	},
	{
		// Read-only question: get_project_state OR a plain-text answer (the
		// state is already in the system prompt) are both acceptable — any
		// mutating call is a routing failure.
		input: { message: "how is my project looking?" },
		expected: { allowNoTool: true, allowReadOnly: true },
	},
	{
		input: { message: "render the final cut" },
		expected: { tool: "render_version" },
	},
	{
		input: { message: "switch the voices to japanese" },
		expected: { tool: "update_languages", args: { audio: "ja" } },
	},
	{
		// The state block lists ids — the agent must pass the FAILED scene's
		// real id, not invent one.
		input: { message: "scene 2 failed, can you fix it?" },
		expected: { tool: "retry_scene", args: { sceneId: SCENE_IDS[1] } },
	},
	{
		// Pure social turn: any tool call is unnecessary; a mutating one is
		// an outright failure.
		input: { message: "that was awesome, thanks!" },
		expected: { allowNoTool: true, allowReadOnly: false },
	},
];

function argsMatch(
	callInput: unknown,
	expectedArgs: Record<string, unknown>,
): boolean {
	if (typeof callInput !== "object" || callInput === null) {
		return Object.keys(expectedArgs).length === 0;
	}
	const record = callInput as Record<string, unknown>;
	return Object.entries(expectedArgs).every(
		([key, value]) => JSON.stringify(record[key]) === JSON.stringify(value),
	);
}

const toolRouting = createScorer<
	RoutingEvalInput,
	RoutingEvalOutput,
	RoutingExpectation
>({
	name: "tool-routing",
	description:
		"Exact expected-tool (+ args subset) match. Mutating tool where none was expected = 0. Unnecessary read-only call where none was expected = 0.5.",
	scorer: ({ output, expected }) => {
		const calls = output.toolCalls;
		const mutatingCalls = calls.filter((call) =>
			(MUTATING_TOOLS as string[]).includes(call.toolName),
		);
		const metadata: Record<string, unknown> = {
			calls,
			text: output.text.slice(0, 280),
		};

		if (expected?.tool) {
			const unexpectedMutating = mutatingCalls.filter(
				(call) => call.toolName !== expected.tool,
			);
			if (unexpectedMutating.length > 0) {
				return {
					score: 0,
					metadata: { ...metadata, reason: "unexpected mutating tool" },
				};
			}
			const match = calls.find((call) => call.toolName === expected.tool);
			if (!match) {
				return {
					score: 0,
					metadata: { ...metadata, reason: "expected tool not called" },
				};
			}
			if (expected.args && !argsMatch(match.input, expected.args)) {
				return {
					score: 0.5,
					metadata: {
						...metadata,
						reason: "right tool, wrong args",
						expectedArgs: expected.args,
					},
				};
			}
			return { score: 1, metadata };
		}

		// No mutating tool expected.
		if (mutatingCalls.length > 0) {
			return {
				score: 0,
				metadata: { ...metadata, reason: "mutating tool where none expected" },
			};
		}
		if (calls.length === 0) {
			return expected?.allowNoTool
				? { score: 1, metadata }
				: { score: 0, metadata: { ...metadata, reason: "no response action" } };
		}
		// Only read-only calls remain (get_project_state).
		return expected?.allowReadOnly
			? { score: 1, metadata }
			: {
					score: 0.5,
					metadata: {
						...metadata,
						reason: "harmless but unnecessary read-only call",
					},
				};
	},
});

// ---------------------------------------------------------------------------

evalite<RoutingEvalInput, RoutingEvalOutput, RoutingExpectation>(
	"studio-tool-routing",
	{
		data: CASES,
		task: async (input) => {
			const result = await generateText({
				model: tracedEvalModel(STUDIO_AGENT_MODEL),
				system: [STUDIO_AGENT_SYSTEM_PROMPT, PROJECT_STATE_BLOCK].join("\n\n"),
				prompt: input.message,
				tools: studioAgentTools,
			});
			return {
				toolCalls: result.toolCalls.map((call) => ({
					toolName: call.toolName,
					input: call.input,
				})),
				text: result.text,
			};
		},
		scorers: [toolRouting],
		columns: async ({ input, output }) => [
			{ label: "Message", value: input.message },
			{
				label: "Tool calls",
				value:
					output.toolCalls
						.map((call) => `${call.toolName}(${JSON.stringify(call.input)})`)
						.join(", ") || "(none)",
			},
			{ label: "Text", value: output.text.slice(0, 160) },
		],
	},
);
