import {
	AudioLanguage,
	MAX_SCENES_PER_GENERATION,
	MIN_SCENES_PER_GENERATION,
	SubtitleLanguage,
} from "@video-platform-challenge/types";
import type { ToolSet } from "ai";
import { tool } from "ai";
import { z } from "zod";

/** The v1 agent tool names (docs §2 "Agent tools (v1 set)" table) — declared
 * as a runtime value (not just derived from `keyof typeof studioAgentTools`)
 * so AI-4 has a concrete array to iterate/filter (e.g. `prepareStep`'s
 * `activeTools`) without importing the whole tool-definition object. */
export const STUDIO_AGENT_TOOL_NAMES = [
	"get_project_state",
	"extend_scenes",
	"retry_scene",
	"render_version",
	"update_languages",
] as const;

export type StudioAgentToolName = (typeof STUDIO_AGENT_TOOL_NAMES)[number];

/**
 * Frames the agent as the episode's co-director with tool access, not a
 * chatbot (docs §2 "Chat semantics"): generation-first, steers the project
 * via tools rather than just discussing it, and never claims a long-running
 * tool call finished before the editor's own status reflects it.
 */
export const STUDIO_AGENT_SYSTEM_PROMPT = [
	"You are the episode's co-director, working inside the Studio alongside the user.",
	"You are generation-first: your job is to DO things to the project via your tools, not just discuss it — the chat is the steering wheel, not the destination.",
	"Ground every action in the project's current state: call get_project_state before proposing changes if you don't already know it.",
	// AI-6a §8b: get_project_state now returns full story visibility — title,
	// synopsis, status, languages, every plan character (name/role/gender/
	// visualDescription), and every scene in timeline order (dialogue,
	// speaker, prompt, duration, status, failReason for failed scenes) — not
	// just ids and statuses. Use it: a co-director's suggestions should read
	// as if it actually watched the episode, not generic filler.
	"You can see the full story through get_project_state: character designs and voices, and every scene's dialogue/action/duration in timeline order. Ground every creative suggestion in what's ALREADY there — reference established characters by name, continue the actual tone and stakes of the story so far, and never propose something that contradicts or ignores it.",
	"Long-running generations (extend_scenes, retry_scene, render_version) return immediately once the work is queued — never claim a result is ready until the editor's own status reflects it; report what you started, not a guess at when it finishes.",
	"Keep responses short and concrete: state what you're about to do, do it via a tool call, then summarize the outcome in one or two sentences.",
	// AI-4: the composer's scene-count pill has no dedicated tool argument
	// of its own — it appends this hint to the outgoing message text instead
	// (apps/web's AgentChatComposer, the Studio rail's chat input), so the
	// agent must know to look for and honor it.
	"If the user's message ends with an explicit scene-count hint like '(generate 3 scenes)' (the composer's scene-count pill appends this automatically), treat that number as the exact sceneCount to pass to extend_scenes — but only when the request is actually about extending/adding scenes; ignore the hint entirely for unrelated requests (retrying a scene, rendering, changing languages, or just chatting).",
].join("\n");

const audioLanguageSchema = z.enum([...Object.values(AudioLanguage)]);
const subtitleLanguageSchema = z.enum([...Object.values(SubtitleLanguage)]);

/**
 * Tool definitions (docs §2 "Agent tools (v1 set)" table) — name,
 * description, and zod input schema only, via `tool()`. No `execute`: the
 * AI-4 chat endpoint binds each tool's real implementation (session, db,
 * workflows) by spreading `execute` onto these definitions at request time.
 *
 * `satisfies ToolSet` (not `: ToolSet`): an explicit `: ToolSet` annotation
 * would fix the TS2883 "inferred type cannot be named" portability error
 * (this package builds with `declaration: true`, and `Tool<...>`'s type
 * comes from the transitive `@ai-sdk/provider-utils`) but at the cost of
 * widening every entry to `Tool<any, any, any>` — exactly the per-tool input
 * inference AI-4 needs when it adds `execute`. `satisfies` validates the
 * same conformance without widening; making `@ai-sdk/provider-utils` a
 * direct dependency (see package.json) is what makes its `Tool<...>` type
 * nameable/portable for the emitted `.d.ts`, resolving TS2883 the right way.
 */
export const studioAgentTools = {
	get_project_state: tool({
		description:
			"Reads the project's current state: title, status, scenes with their statuses, and the live timeline. Call this before proposing changes if the current state isn't already known.",
		inputSchema: z.object({}),
	}),
	extend_scenes: tool({
		description:
			"Extends the story by adding new scenes in-style, continuing from the current last keyframe. Kicks off a generation batch and returns immediately — it does not wait for the scenes to finish rendering.",
		inputSchema: z.object({
			// Optional to match project.service.extend's own
			// extendProjectInputSchema — the extend agent always receives the
			// story-so-far as context regardless of whether this is given, so a
			// bare "continue the story" request must not be forced to fabricate
			// filler direction just to satisfy this field.
			instruction: z
				.string()
				.min(1)
				.max(2000)
				.optional()
				.describe(
					"Optional creative direction for the new scenes (e.g. 'the crowd goes silent'). Omit to continue the story naturally with no specific direction.",
				),
			sceneCount: z
				.number()
				.int()
				.min(MIN_SCENES_PER_GENERATION)
				.max(MAX_SCENES_PER_GENERATION)
				.describe(
					"How many NEW scenes to append to the end of the current story — the size of THIS batch, not the desired total scene count.",
				),
		}),
	}),
	retry_scene: tool({
		description:
			"Re-kicks generation for one failed scene. Only scenes in a failed state can be retried.",
		inputSchema: z.object({
			sceneId: z
				.string()
				.min(1)
				.describe(
					"The id of a scene currently in a failed state, taken from get_project_state's scene list. Never invent an id.",
				),
		}),
	}),
	render_version: tool({
		description:
			"Requests a final render of the project's current live timeline as a new version. Returns immediately once the render is queued.",
		inputSchema: z.object({}),
	}),
	update_languages: tool({
		description:
			"Updates the project's audio (spoken dialogue) and/or subtitle (caption) language. Provide at least one of audio or subtitles — calling this with neither is rejected. Changing the subtitle language also RE-TRANSLATES every existing scene's captions into the new language and refreshes the Player.",
		inputSchema: z
			.object({
				audio: audioLanguageSchema
					.optional()
					.describe("New spoken-dialogue language for the episode."),
				subtitles: subtitleLanguageSchema
					.optional()
					.describe("New caption/subtitle language for the episode."),
			})
			.refine(
				(value) => value.audio !== undefined || value.subtitles !== undefined,
				{
					message: "Provide at least one of audio or subtitles.",
				},
			),
	}),
} satisfies ToolSet;
