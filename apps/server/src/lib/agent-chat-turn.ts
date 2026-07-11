// Pure, DB-free core of `agent-chat.service.ts::buildStudioChat`'s pre-stream
// orchestration (AI-6a §8a fixes 2-6) — same DI-core precedent as
// `lib/mark-rendered.ts`/`lib/timeline.ts`: `agent-chat.service.ts` itself
// transitively imports `@video-platform-challenge/db`, which resolves
// `cloudflare:workers` at module load and can't be imported under plain
// `bun test` — everything decidable from already-fetched data lives here
// instead, so ownership-before-persist ordering, history-merge dedup/
// ordering, and the rate-limit threshold are all testable with plain
// objects, no mocking framework. `runAgentTurnTx` (AI-6c) extends this with
// the tx-ORDERING half of the same orchestration — it isn't pure (it awaits
// injected DB ops), but those ops are plain functions too, so the call order
// itself (lock -> reads -> count -> insert) stays testable the same way.
import { MAX_AGENT_TURNS_PER_HOUR } from "@video-platform-challenge/types";
import type { UIMessage } from "ai";

/** The subset of `AgentMessageRow` this module needs — kept as a local shape
 * (not importing the repository's row type) so this file has zero db-adjacent
 * imports. */
export interface PersistedAgentMessage {
	id: string;
	role: "system" | "user" | "assistant";
	parts: unknown[];
	createdAt: Date;
}

/** Model context cap (docs §8a fix 3): after merging persisted history with
 * the incoming client messages, only the last N feed `convertToModelMessages`
 * — bounds the gateway call's token cost regardless of how long a project's
 * chat log has grown. */
export const DEFAULT_MAX_CONTEXT_MESSAGES = 30;

export type AgentTurnPlan =
	| { type: "not_found" }
	| { type: "rate_limited" }
	| {
			type: "ok";
			/** Persisted history + any client messages unknown to persistence,
			 * ordered by (createdAt, insertion) and capped to the context window —
			 * feed this straight to `convertToModelMessages`. */
			modelMessages: UIMessage[];
			/** The new user turn to persist BEFORE streaming, or `null` when the
			 * latest client message is already persisted (a resync) or isn't a
			 * user message at all. */
			userMessageToPersist: UIMessage | null;
	  };

export interface PlanAgentTurnInput {
	/** Whether the project (already ownership-filtered by the caller's
	 * `withUser` query) was found — `false` short-circuits to `not_found`
	 * BEFORE the rate-limit check or the merge ever run, so the caller can
	 * throw `ORPCError("NOT_FOUND")` without having persisted anything. */
	projectExists: boolean;
	/** The project's persisted chat log, already ordered (createdAt asc, id
	 * asc — repository's own `findByProjectId` ordering). */
	persistedHistory: PersistedAgentMessage[];
	/** The client's full `messages` array for this turn (AI SDK `useChat`
	 * sends the whole conversation every request). */
	incomingMessages: UIMessage[];
	/** How many user-role turns this (project, user) has persisted in the
	 * last rolling hour — the repository's `countUserMessagesSince`. */
	recentUserMessageCount: number;
	/** Overridable for tests; defaults to the shared constant. */
	maxTurnsPerHour?: number;
	/** Overridable for tests; defaults to `DEFAULT_MAX_CONTEXT_MESSAGES`. */
	maxContextMessages?: number;
}

function toUIMessageShape(row: PersistedAgentMessage): UIMessage {
	return {
		id: row.id,
		role: row.role,
		parts: row.parts as UIMessage["parts"],
	};
}

/**
 * Decides what one `POST /agent/:projectId/chat` turn does BEFORE the model
 * ever streams (docs §8a fixes 3, 4, 5):
 *  - ownership miss -> `not_found`, checked first, no persist/rate-limit work
 *    happens (mirrors `buildStudioChat`'s own early-return shape).
 *  - a genuinely NEW user message (its id isn't already persisted) against an
 *    at/over-cap sender -> `rate_limited`, BEFORE that message is persisted.
 *  - otherwise: persisted history + any client messages unknown to
 *    persistence are merged (persisted rows win on id conflict, unknown
 *    client messages are appended in their own relative order — persisted
 *    rows already carry a real `createdAt`; client-only messages have none,
 *    so "order by createdAt then insertion order" reduces to "persisted
 *    first, unknowns appended after" here), then capped to the last
 *    `maxContextMessages`.
 */
export function planAgentTurn(input: PlanAgentTurnInput): AgentTurnPlan {
	if (!input.projectExists) {
		return { type: "not_found" };
	}

	const persistedIds = new Set(input.persistedHistory.map((row) => row.id));
	const latest = input.incomingMessages[input.incomingMessages.length - 1];
	const userMessageToPersist =
		latest !== undefined &&
		latest.role === "user" &&
		!persistedIds.has(latest.id)
			? latest
			: null;

	const maxTurns = input.maxTurnsPerHour ?? MAX_AGENT_TURNS_PER_HOUR;
	if (userMessageToPersist && input.recentUserMessageCount >= maxTurns) {
		return { type: "rate_limited" };
	}

	const merged: UIMessage[] = [
		...input.persistedHistory.map(toUIMessageShape),
		...input.incomingMessages.filter(
			(message) => !persistedIds.has(message.id),
		),
	];
	const cap = input.maxContextMessages ?? DEFAULT_MAX_CONTEXT_MESSAGES;

	return {
		modelMessages: merged.slice(-cap),
		type: "ok",
		userMessageToPersist,
	};
}

/**
 * Whether an assistant `UIMessage`'s `parts` carry anything worth persisting
 * (docs §8a fix 2): a stream that errors before ever emitting a chunk resolves
 * `onFinish` with an EMPTY `parts: []` — persisting that leaves a garbage
 * assistant row with nothing to render. A part counts as meaningful when it's
 * anything other than a blank/whitespace-only text part — any tool part,
 * reasoning part, file part, etc. represents real turn content even without
 * accompanying prose.
 */
export function hasMeaningfulAssistantContent(
	parts: readonly UIMessage["parts"][number][],
): boolean {
	return parts.some((part) =>
		part.type === "text" ? part.text.trim().length > 0 : true,
	);
}

/**
 * The tx-bound operations `runAgentTurnTx` sequences (AI-6c) — every op is
 * already scoped to the target project/user by the caller's closures (see
 * `agent-chat.service.ts::buildStudioChat`), so this file never needs to
 * know a projectId/userId exists. Generic over the project/scene row shapes
 * so this stays free of any repository type import.
 */
export interface AgentTurnTxOps<TProject, TScene> {
	/** MUST run first: `SELECT ... FOR UPDATE` on the project row (the SAME
	 * `project.repository.ts::findByIdForUpdate` lock `project.service.ts::
	 * extend` uses to serialize concurrent generation kicks on one project).
	 * Holding this lock for the rest of the transaction is what turns
	 * `countRecentUserMessages` + `insertUserMessage` below into an atomic
	 * check-then-act pair — a second concurrent turn on the SAME project
	 * blocks here until the first transaction commits (or rolls back), so it
	 * always counts against the first's already-committed insert instead of a
	 * stale below-cap snapshot. Returns `null` when the project doesn't exist
	 * or isn't owned by this user. */
	lockProject: () => Promise<TProject | null>;
	findScenes: () => Promise<TScene[]>;
	findHistory: () => Promise<PersistedAgentMessage[]>;
	/** Scoped to "since one rolling hour ago" by the caller's closure. */
	countRecentUserMessages: () => Promise<number>;
	insertUserMessage: (message: UIMessage) => Promise<void>;
}

export type AgentTurnTxResult<TProject, TScene> =
	| { type: "not_found" }
	| { type: "rate_limited" }
	| {
			type: "ok";
			project: TProject;
			scenes: TScene[];
			plan: Extract<AgentTurnPlan, { type: "ok" }>;
	  };

/**
 * Runs one chat turn's WHOLE pre-stream sequence — lock, reads, the
 * rate-limit decision (via the unchanged `planAgentTurn`), and the
 * conditional user-message insert — against injected, already tx-bound
 * operations, so the exact call order (lock -> reads -> count -> insert) is
 * assertable with plain fakes (same DI-core precedent as
 * `services/generation-webhook.service.ts::handleKieWebhook`) without ever
 * importing `@video-platform-challenge/db`. The caller wraps this in ONE
 * `withUser(...)` transaction with every op bound to the SAME `tx` —
 * `lockProject`'s row lock is what makes count-then-insert atomic per
 * project (AI-6c fix: closes the rate-limit TOCTOU where two concurrent
 * requests could both read a below-cap count before either had inserted).
 */
export async function runAgentTurnTx<TProject, TScene>(
	ops: AgentTurnTxOps<TProject, TScene>,
	input: {
		incomingMessages: UIMessage[];
		maxTurnsPerHour?: number;
		maxContextMessages?: number;
	},
): Promise<AgentTurnTxResult<TProject, TScene>> {
	const project = await ops.lockProject();
	if (!project) {
		return { type: "not_found" };
	}

	const scenes = await ops.findScenes();
	const persistedHistory = await ops.findHistory();
	const recentUserMessageCount = await ops.countRecentUserMessages();

	const plan = planAgentTurn({
		incomingMessages: input.incomingMessages,
		maxContextMessages: input.maxContextMessages,
		maxTurnsPerHour: input.maxTurnsPerHour,
		persistedHistory,
		projectExists: true,
		recentUserMessageCount,
	});

	if (plan.type === "rate_limited") {
		return { type: "rate_limited" };
	}
	// Unreachable here (`projectExists: true` above, always) — kept
	// exhaustive so a future change to `planAgentTurn`'s contract fails to
	// compile here instead of silently mishandling it.
	if (plan.type === "not_found") {
		return { type: "not_found" };
	}

	if (plan.userMessageToPersist) {
		await ops.insertUserMessage(plan.userMessageToPersist);
	}

	return { plan, project, scenes, type: "ok" };
}
