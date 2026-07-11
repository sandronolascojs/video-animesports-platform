// Fix-pass W9c: the kie.ai webhook route's branching logic, extracted out of
// src/index.ts's route handler so the route stays thin (router pattern:
// wiring only, no business logic — see CLAUDE.md's router -> service ->
// repository rule) and the branching itself becomes unit-testable.
//
// Unlike every other service in this codebase, `handleKieWebhook` takes its
// DB/env/workflow-binding-touching dependencies as EXPLICIT parameters
// instead of importing generationTaskRepository/env directly. Importing
// either (or anything importing @video-platform-challenge/db) resolves
// `cloudflare:workers` at module load, which plain `bun test` can't do —
// see apps/server/src/lib/fail-reason.ts and lib/timeline.ts's doc comments
// for the same constraint. This keeps `handleKieWebhook` itself pure/
// testable with plain fake functions (no mocking framework needed), while
// the route (src/index.ts, which already imports env/repositories at its
// own top level) wires the real implementations.
//
// `parseKieWebhookPayload`/`verifyWebhookSignature` are imported from the
// `/webhook` subpath (packages/kie's `"./*"` export map entry), NOT the
// package barrel — the barrel's `export * from "./client"` would pull in
// client.ts's own `env` import and break this file's testability the same
// way.
import {
	parseKieWebhookPayload,
	verifyWebhookSignature,
} from "@video-platform-challenge/kie/webhook";
import { GenerationTaskStatus } from "@video-platform-challenge/types";

const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

export interface KieWebhookTaskLookup {
	kieTaskId: string;
	workflowInstanceId: string;
	status: string;
}

export interface KieWorkflowInstanceHandle {
	sendEvent(event: { type: string; payload: unknown }): Promise<void>;
}

export interface HandleKieWebhookInput {
	timestamp: string | undefined;
	signature: string | undefined;
	contentLength: number | undefined;
	readBody: () => Promise<string>;
	webhookSecret: string;
	findTaskByKieTaskId: (
		kieTaskId: string,
	) => Promise<KieWebhookTaskLookup | null>;
	getWorkflowInstance: (
		instanceId: string,
	) => Promise<KieWorkflowInstanceHandle>;
}

export type KieWebhookResult =
	| { status: 401; message: "Unauthorized" }
	| { status: 400; message: "Bad Request" }
	| { status: 413; message: "Payload Too Large" }
	| { status: 200; message: "OK" };

const UNAUTHORIZED: KieWebhookResult = { status: 401, message: "Unauthorized" };
const BAD_REQUEST: KieWebhookResult = { status: 400, message: "Bad Request" };
const PAYLOAD_TOO_LARGE: KieWebhookResult = {
	status: 413,
	message: "Payload Too Large",
};
const OK: KieWebhookResult = { status: 200, message: "OK" };

/**
 * Server-to-server HMAC, deliberately no auth middleware (docs §5d rule 12,
 * phase 3b-2 design anchor 4). Behavior matrix:
 *   - missing/invalid HMAC signature headers   -> 401
 *   - declared or actual body oversized (W2)   -> 413
 *   - malformed body / missing taskId          -> 400
 *   - signature valid, taskId unknown          -> 200 (idempotent)
 *   - signature valid, task already resolved   -> 200 (duplicate delivery,
 *     including C4's own poll-exhaustion TIMEOUT path — logged, no re-ingest)
 *   - signature valid, task pending            -> resolves the owning
 *     workflow instance and sendEvent()s it, then 200 regardless of whether
 *     sendEvent itself succeeds (an instance that moved on via the poll
 *     fallback before this callback arrived is not an error here)
 * Always fast + 200 on the happy path: this is a trigger only — the workflow
 * re-fetches `recordInfo` itself as the source of truth (docs §3).
 */
export async function handleKieWebhook(
	input: HandleKieWebhookInput,
): Promise<KieWebhookResult> {
	// Pre-auth hardening (W2): reject before ever reading the body. Missing
	// signature/timestamp headers or an oversized declared Content-Length are
	// rejected on header inspection alone.
	if (!input.timestamp || !input.signature) {
		return UNAUTHORIZED;
	}
	if (
		input.contentLength !== undefined &&
		input.contentLength > MAX_WEBHOOK_BODY_BYTES
	) {
		return PAYLOAD_TOO_LARGE;
	}

	const rawBody = await input.readBody();
	if (rawBody.length > MAX_WEBHOOK_BODY_BYTES) {
		// Content-Length can be absent/spoofed — re-check the actual body once
		// it's in hand, same bound.
		return PAYLOAD_TOO_LARGE;
	}

	let taskId: string;
	try {
		({ taskId } = parseKieWebhookPayload(rawBody));
	} catch (error) {
		console.error("[webhook:kie] failed to parse payload", error);
		return BAD_REQUEST;
	}

	const valid = await verifyWebhookSignature({
		taskId,
		timestamp: input.timestamp,
		signature: input.signature,
		secret: input.webhookSecret,
	});
	if (!valid) {
		return UNAUTHORIZED;
	}

	const task = await input.findTaskByKieTaskId(taskId);
	if (!task) {
		console.warn(`[webhook:kie] unknown taskId ${taskId}`);
		return OK;
	}
	if (task.status !== GenerationTaskStatus.PENDING) {
		console.log(
			`[webhook:kie] task ${taskId} already ${task.status} — logged for reconciliation, no re-ingest`,
		);
		return OK;
	}

	try {
		const instance = await input.getWorkflowInstance(task.workflowInstanceId);
		await instance.sendEvent({
			type: `kie-task:${taskId}`,
			payload: { taskId },
		});
	} catch (error) {
		console.warn(`[webhook:kie] sendEvent failed for task ${taskId}`, error);
	}

	return OK;
}
