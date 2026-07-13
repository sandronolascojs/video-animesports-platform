// The Studio agent's chat orchestration (docs ai-architecture-v1.md §2, §3;
// completes the AI-4 scaffolding from packages/ai/src/agents/studio.agent.ts
// — see that file's doc comment for why tool DEFINITIONS live there and tool
// EXECUTION lives here). Two entry points:
//  - `history()` — the oRPC `agent.history` procedure's backing call, the
//    Studio chat's initial `useChat` seed.
//  - `buildStudioChat()` — the chat endpoint's core (`POST
//    /agent/:projectId/chat`, wired in apps/server/src/index.ts): verifies
//    ownership, persists the incoming user turn, assembles the system
//    prompt + bound tools, and returns the live `streamText` result for the
//    route to pipe into `toUIMessageStreamResponse()`.
//
// Rate limits: extend_scenes and retry_scene funnel into
// project.service.extend / scene.service.retry, which already enforce
// MAX_GENERATION_KICKS_PER_HOUR — the agent gets that limit for free, no
// duplicate check needed here (docs §7 open question, verified). render_version
// and update_languages funnel into version.service.render /
// project.service.updateLanguages, neither of which is rate-limited today —
// same as their oRPC counterparts, so this is not a new gap the agent
// introduces.
import { ORPCError } from "@orpc/server";
import {
	formatProjectState as formatProjectStateBlock,
	gatewayModel,
	STUDIO_AGENT_MODEL,
	STUDIO_AGENT_SYSTEM_PROMPT,
	studioAgentTools,
} from "@video-platform-challenge/ai";
import type { AgentMessage as AgentMessageDto } from "@video-platform-challenge/api";
import { rateLimitedError } from "@video-platform-challenge/api";
import { db, withUser } from "@video-platform-challenge/db";
import {
	convertToModelMessages,
	pruneMessages,
	type StreamTextResult,
	stepCountIs,
	streamText,
	type ToolSet,
	tool,
	type UIMessage,
} from "ai";
import {
	hasMeaningfulAssistantContent,
	type PersistedAgentMessage,
	runAgentTurnTx,
} from "../lib/agent-chat-turn";
import type { Context } from "../lib/context";
import { buildProjectStateForTool } from "../lib/project-state-for-tool";
import * as agentMessageRepository from "../repositories/agent-message.repository";
import type { ProjectRow } from "../repositories/project.repository";
import * as projectRepository from "../repositories/project.repository";
import type { SceneRow } from "../repositories/scene.repository";
import * as sceneRepository from "../repositories/scene.repository";
import * as generationService from "./generation.service";
import * as projectService from "./project.service";
import * as sceneService from "./scene.service";
import * as versionService from "./version.service";

const ONE_HOUR_MS = 60 * 60 * 1000;

type SessionUser = NonNullable<Context["session"]>;

// Context budget (studio.agent.ts's own doc comment): allow a handful of
// tool-call steps plus a closing text summary in one turn (e.g.
// get_project_state -> extend_scenes -> summarize is 3 steps) without
// letting a misbehaving loop run away.
const STUDIO_AGENT_MAX_STEPS = 6;
// Prune older tool-call/result content every 4 steps, keeping the last few
// steps verbatim — the exact mechanism studio.agent.ts's doc comment
// prescribes for this endpoint.
const PRUNE_STEP_INTERVAL = 4;
const PRUNE_KEEP_MESSAGES = 4;

function toAgentMessageDto(
	row: agentMessageRepository.AgentMessageRow,
): AgentMessageDto {
	return {
		id: row.id,
		// `agentMessageRoleSchema` (packages/api) is a strict subset of the
		// plain-text DB column — every row this table ever writes originates
		// from a real AI SDK `UIMessage["role"]`, so this narrowing is safe by
		// construction (see agent-message.ts's own doc comment).
		role: row.role as AgentMessageDto["role"],
		parts: row.parts,
		createdAt: row.createdAt,
	};
}

type HistoryOptions = { session: SessionUser; projectId: string };

/**
 * Loads a project's persisted chat log, oldest first (docs §2 "Chat
 * semantics"). Ownership is verified the same way every other project-scoped
 * read is (`project.repository.findById` inside `withUser`) — a foreign or
 * nonexistent project resolves to the same NOT_FOUND either way (docs
 * §5d.6).
 */
export async function history({
	session,
	projectId,
}: HistoryOptions): Promise<AgentMessageDto[]> {
	const userId = session.user.id;

	return withUser(db, userId, async (tx) => {
		const project = await projectRepository.findById(tx, userId, projectId);
		if (!project) {
			throw new ORPCError("NOT_FOUND");
		}

		const rows = await agentMessageRepository.findByProjectId(
			tx,
			userId,
			projectId,
		);
		return rows.map(toAgentMessageDto);
	});
}

type ProjectState = { project: ProjectRow; scenes: SceneRow[] };

/**
 * Fresh project + scenes read, reused by both the system-prompt's initial
 * state block AND `get_project_state`'s `execute` (the tool re-reads rather
 * than replaying the turn-start snapshot, since earlier tool calls in the
 * SAME multi-step turn — e.g. extend_scenes before a follow-up
 * get_project_state — can have already changed it).
 */
async function loadProjectState(
	userId: string,
	projectId: string,
): Promise<ProjectState | null> {
	return withUser(db, userId, async (tx) => {
		const project = await projectRepository.findById(tx, userId, projectId);
		if (!project) {
			return null;
		}
		const scenes = await sceneRepository.findManyByProjectId(
			tx,
			userId,
			projectId,
		);
		return { project, scenes };
	});
}

/** Compact system-prompt block — lean by design (studio.agent.ts's doc
 * comment: "keep each tool's result payload lean... so pruning has less to
 * compact"), not a full row dump. The TEXT format lives in packages/ai's
 * `formatProjectState` (phase AI-6b — the studio tool-routing eval exercises
 * the exact production block); this stays the row→plain-data adapter. Scene
 * order is passed through untouched (same row order as before the move). */
export function formatProjectState(
	project: ProjectRow,
	scenes: SceneRow[],
): string {
	return formatProjectStateBlock({
		title: project.title,
		status: project.status,
		synopsis: project.synopsis,
		scenes: scenes.map((scene) => ({
			id: scene.id,
			title: scene.title,
			status: scene.status,
		})),
	});
}

// `get_project_state`'s tool-result mapping (title/synopsis/status/
// languages, plan characters, timeline-ordered scenes with dialogue/prompt/
// failReason, capped — docs §8b) is `buildProjectStateForTool` in
// lib/project-state-for-tool.ts (AI-6c: extracted so it's directly
// bun-testable — see that file's doc comment).

function toToolErrorMessage(error: unknown): string {
	if (error instanceof ORPCError) {
		return typeof error.message === "string" && error.message.length > 0
			? error.message
			: String(error.code);
	}
	return "Something went wrong.";
}

/**
 * Binds the packages/ai tool DEFINITIONS to real EXECUTION (docs §2, §3
 * "dependency injection... the package stays pure"). Every mutating tool
 * catches its underlying service's typed errors (NOT_FOUND/CONFLICT/
 * RATE_LIMITED) and returns them as a small `{ error }` payload instead of
 * throwing — the model gets a clean result to react to and explain to the
 * user ("this project is already generating") instead of the whole stream
 * erroring out.
 */
function bindStudioAgentTools({
	session,
	projectId,
	userId,
}: {
	session: SessionUser;
	projectId: string;
	userId: string;
}) {
	return {
		get_project_state: tool({
			...studioAgentTools.get_project_state,
			execute: async () => {
				const state = await loadProjectState(userId, projectId);
				if (!state) {
					return { error: "Project not found." };
				}
				return buildProjectStateForTool(state.project, state.scenes);
			},
		}),
		extend_scenes: tool({
			...studioAgentTools.extend_scenes,
			execute: async ({ instruction, sceneCount }) => {
				try {
					await projectService.extend({
						session,
						id: projectId,
						prompt: instruction,
						sceneCount,
					});
					return { started: true, sceneCount };
				} catch (error) {
					return { started: false, error: toToolErrorMessage(error) };
				}
			},
		}),
		retry_scene: tool({
			...studioAgentTools.retry_scene,
			execute: async ({ sceneId }) => {
				try {
					await sceneService.retry({ session, id: sceneId });
					return { started: true, sceneId };
				} catch (error) {
					return { started: false, error: toToolErrorMessage(error) };
				}
			},
		}),
		render_version: tool({
			...studioAgentTools.render_version,
			execute: async () => {
				try {
					const version = await versionService.render({ session, projectId });
					return { started: true, versionNumber: version.number };
				} catch (error) {
					return { started: false, error: toToolErrorMessage(error) };
				}
			},
		}),
		update_languages: tool({
			...studioAgentTools.update_languages,
			execute: async ({ audio, subtitles }) => {
				try {
					const before = await projectService.get({ session, id: projectId });
					const updated = await projectService.updateLanguages({
						session,
						id: projectId,
						audioLanguage: audio,
						subtitleLanguage: subtitles,
					});
					let translatedScenes = 0;
					if (subtitles && subtitles !== before.subtitleLanguage) {
						translatedScenes =
							await generationService.translateAndStoreProjectSubtitles(
								userId,
								projectId,
								subtitles,
							);
					}
					return {
						updated: true,
						audioLanguage: updated.audioLanguage,
						subtitleLanguage: updated.subtitleLanguage,
						translatedScenes,
					};
				} catch (error) {
					return { updated: false, error: toToolErrorMessage(error) };
				}
			},
		}),
	} satisfies ToolSet;
}

type BuildStudioChatOptions = {
	session: SessionUser;
	projectId: string;
	messages: UIMessage[];
};

// `apps/server`'s `composite`/`tsc -b` build requires every exported
// function's return type to be fully nameable/portable — but the FULL
// `StreamTextResult<TOOLS, RUNTIME_CONTEXT, OUTPUT>` type isn't: its
// `OUTPUT` generic defaults to an internal `Output<...>` interface (ai@7.0.22)
// that collides with the VALUE `output` namespace re-exported under the same
// name, so TS can't print it (TS4058) regardless of which TOOLS type is used.
// The route only ever calls `.toUIMessageStreamResponse()` — a method whose
// own signature is generic over the UI message shape, not over
// TOOLS/OUTPUT — so the exported type is narrowed to exactly that one
// member; `any` in the outer generic slots collapses the unreachable
// internal reference without losing anything the route actually uses.
type StudioChatStream = Pick<
	// biome-ignore lint/suspicious/noExplicitAny: deliberate, see the comment above — collapses an unnameable internal type, never used to type-check real values.
	StreamTextResult<any, any, any>,
	"toUIMessageStreamResponse"
>;

export type StudioChat = {
	result: StudioChatStream;
	/** Persists the assistant's finished turn — called from the route's
	 * `toUIMessageStreamResponse({ onFinish })`. */
	persistAssistantMessage: (message: UIMessage) => Promise<void>;
};

/**
 * The chat endpoint's core (docs §2 "Transport"): verifies project
 * ownership, merges the persisted chat log with the incoming client
 * messages (docs §8a fix 3 — the client's `messages` array is never trusted
 * as the WHOLE conversation), rate-limits new user turns (fix 5), persists
 * the incoming user turn, assembles `STUDIO_AGENT_SYSTEM_PROMPT` + a compact
 * project-state block, binds the v1 toolset, and returns the live
 * `streamText` result. The route (apps/server/src/index.ts) owns the HTTP
 * glue (session extraction, body parsing/validation, piping the result into
 * `toUIMessageStreamResponse()`).
 *
 * AI-6c: ownership, the chat-log read, the rate-limit count, and the new
 * user-message insert all now run inside ONE `withUser` transaction via
 * `runAgentTurnTx`, with `projectRepository.findByIdForUpdate`'s
 * `SELECT ... FOR UPDATE` taken FIRST — the SAME project-row lock
 * `project.service.ts::extend` uses to serialize concurrent generation
 * kicks on one project. Holding that lock for the transaction's lifetime is
 * what closes the count-then-insert TOCTOU: two concurrent turns on the
 * SAME project can no longer both read a below-cap `recentUserMessageCount`
 * before either insert commits — the second transaction blocks on the lock
 * until the first commits (or rolls back), then re-counts against the
 * first's already-committed insert. Previously these three steps ran as
 * separate transactions, leaving exactly that race open.
 */
export async function buildStudioChat({
	session,
	projectId,
	messages,
}: BuildStudioChatOptions): Promise<StudioChat> {
	const userId = session.user.id;
	const recentSince = new Date(Date.now() - ONE_HOUR_MS);

	const turnResult = await withUser(db, userId, (tx) =>
		runAgentTurnTx(
			{
				countRecentUserMessages: () =>
					agentMessageRepository.countUserMessagesSince(
						tx,
						userId,
						projectId,
						recentSince,
					),
				findHistory: async () => {
					const rows = await agentMessageRepository.findByProjectId(
						tx,
						userId,
						projectId,
					);
					// `AgentMessageRow.role` is a plain `text` DB column — every row
					// this table ever writes originates from a real AI SDK
					// `UIMessage["role"]` (see `toAgentMessageDto`'s own doc comment
					// for the same narrowing).
					return rows.map((row) => ({
						...row,
						role: row.role as PersistedAgentMessage["role"],
					}));
				},
				findScenes: () =>
					sceneRepository.findManyByProjectId(tx, userId, projectId),
				insertUserMessage: async (message) => {
					await agentMessageRepository.insertMany(tx, [
						{
							projectId,
							userId,
							role: message.role,
							parts: message.parts,
						},
					]);
				},
				lockProject: () =>
					projectRepository.findByIdForUpdate(tx, userId, projectId),
			},
			{ incomingMessages: messages },
		),
	);

	if (turnResult.type === "not_found") {
		throw new ORPCError("NOT_FOUND");
	}
	if (turnResult.type === "rate_limited") {
		throw new ORPCError("RATE_LIMITED", {
			status: rateLimitedError.status,
			message: rateLimitedError.message,
		});
	}

	const { plan, project, scenes } = turnResult;

	const systemPrompt = [
		STUDIO_AGENT_SYSTEM_PROMPT,
		formatProjectState(project, scenes),
	].join("\n\n");

	const tools = bindStudioAgentTools({ session, projectId, userId });

	const result = streamText({
		model: gatewayModel(STUDIO_AGENT_MODEL),
		system: systemPrompt,
		messages: await convertToModelMessages(plan.modelMessages),
		tools,
		stopWhen: stepCountIs(STUDIO_AGENT_MAX_STEPS),
		prepareStep: ({ stepNumber, messages: stepMessages }) => {
			if (stepNumber > 0 && stepNumber % PRUNE_STEP_INTERVAL === 0) {
				return {
					messages: pruneMessages({
						messages: stepMessages,
						toolCalls: `before-last-${PRUNE_KEEP_MESSAGES}-messages`,
						emptyMessages: "remove",
					}),
				};
			}
			return {};
		},
	});

	return {
		result,
		persistAssistantMessage: async (message: UIMessage) => {
			// docs §8a fix 2: a stream that errors before emitting any chunk
			// resolves `onFinish` with an empty `parts: []` assistant message —
			// persisting that leaves a dead row the sidebar renders as nothing.
			// Skip it and log server-side (with projectId) instead of writing
			// garbage.
			if (!hasMeaningfulAssistantContent(message.parts)) {
				console.error(
					`[agent-chat] skipping persistence of empty assistant turn for project ${projectId}`,
				);
				return;
			}
			await withUser(db, userId, (tx) =>
				agentMessageRepository.insertMany(tx, [
					{
						projectId,
						userId,
						role: message.role,
						parts: message.parts,
					},
				]),
			);
		},
	};
}
