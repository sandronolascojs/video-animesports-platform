import { env } from "@video-platform-challenge/env/server";

import { KieError } from "./errors";

// Verified against https://docs.kie.ai/common-api/quickstart and every
// model page fetched for this package (2026-07-11) — every kie.ai model
// shares this one base URL + endpoint pair, per
// docs/video-engine-architecture.md §3.
const KIE_API_BASE_URL = "https://api.kie.ai";

interface KieEnvelope<T> {
	code: number;
	msg: string;
	data: T;
}

function authHeaders(): HeadersInit {
	return {
		Authorization: `Bearer ${env.KIE_API_KEY}`,
		"Content-Type": "application/json",
	};
}

async function kieFetch<T>(
	path: string,
	init: { method: "GET" | "POST"; body?: string },
	taskId?: string,
): Promise<KieEnvelope<T>> {
	let response: Response;
	try {
		response = await fetch(`${KIE_API_BASE_URL}${path}`, {
			method: init.method,
			body: init.body,
			headers: authHeaders(),
		});
	} catch (cause) {
		throw new KieError("Network error calling kie.ai", { taskId, cause });
	}

	const bodyText = await response.text();
	let body: KieEnvelope<T> | undefined;
	let parseFailed = false;
	try {
		body =
			bodyText.length > 0
				? (JSON.parse(bodyText) as KieEnvelope<T>)
				: undefined;
	} catch {
		body = undefined;
		parseFailed = true;
	}

	// Fix-pass W8: an HTTP-200-but-unparseable/empty body is a transient
	// provider hiccup (a truncated response, a proxy/edge blip), NOT a
	// deliberate rejection — it must be retryable, unlike a real 4xx
	// validation error. Passing `status: undefined` here (instead of the
	// HTTP 200 that produced it) makes `KieError`'s own `isRetryableStatus`
	// treat it the same as a network failure (retryable=true), rather than
	// the previous behavior where a 200 status made it non-retryable even
	// though nothing usable was ever returned.
	if (response.ok && parseFailed) {
		throw new KieError("kie.ai returned an unparseable response body", {
			code: "UNPARSEABLE_RESPONSE",
			taskId,
		});
	}

	if (!response.ok || !body || body.code !== 200) {
		// Surface the REAL rejection reason. Downstream only keeps the numeric
		// fail code (lib/fail-reason.ts renders "(kie 400)"), so kie's own `msg`
		// — the actionable detail (a rejected prompt, an unreachable input_url,
		// a bad param) — would otherwise vanish. Log the full body once here so
		// the cause is visible in server logs (docs/studio-fixes-backlog.md #6).
		console.error("[kie] request failed", {
			path,
			taskId,
			httpStatus: response.status,
			code: body?.code,
			msg: body?.msg,
			// Truncated so a huge/HTML error page can't flood the log.
			body: bodyText.slice(0, 1000),
		});
		throw new KieError(
			body?.msg ?? `kie.ai request failed (HTTP ${response.status})`,
			{
				status: body?.code ?? response.status,
				code: body?.code !== undefined ? String(body.code) : undefined,
				taskId,
			},
		);
	}

	return body;
}

export interface CreateTaskOptions {
	/** kie.ai model identifier, e.g. "bytedance/seedance-2-mini". */
	model: string;
	/**
	 * Model-specific input object. Shape is owned by each caller (see
	 * image.ts / video.ts / speech.ts) — this layer stays generic.
	 */
	input: Record<string, unknown>;
	/** Where kie.ai POSTs the completion callback. Omit to rely on polling only. */
	callBackUrl?: string;
}

export interface CreateTaskResult {
	taskId: string;
	/**
	 * Present on some models (e.g. ElevenLabs) alongside taskId; kie.ai
	 * doesn't document it consistently across model families, so it's kept
	 * optional here.
	 */
	recordId?: string;
}

/**
 * `POST /api/v1/jobs/createTask` — the single entry point for every kie.ai
 * model. See docs/video-engine-architecture.md §3.
 */
export async function createTask({
	model,
	input,
	callBackUrl,
}: CreateTaskOptions): Promise<CreateTaskResult> {
	const envelope = await kieFetch<{ taskId: string; recordId?: string }>(
		"/api/v1/jobs/createTask",
		{
			method: "POST",
			body: JSON.stringify({
				model,
				input,
				...(callBackUrl ? { callBackUrl } : {}),
			}),
		},
	);

	return { taskId: envelope.data.taskId, recordId: envelope.data.recordId };
}

export type KieTaskState =
	| "waiting"
	| "queuing"
	| "generating"
	| "success"
	| "fail";

export interface KieTaskRecord {
	taskId: string;
	model: string;
	state: KieTaskState;
	/** Parsed out of the `resultJson` string field; empty until `state === "success"`. */
	resultUrls: string[];
	failCode?: string;
	failMsg?: string;
	creditsConsumed?: number;
	createTime?: number;
	completeTime?: number;
}

interface KieRecordInfoData {
	taskId: string;
	model: string;
	state: KieTaskState;
	resultJson?: string;
	failCode?: string;
	failMsg?: string;
	creditsConsumed?: number;
	createTime?: number;
	completeTime?: number;
}

function parseResultUrls(resultJson: string | undefined): string[] {
	if (!resultJson) {
		return [];
	}
	try {
		const parsed = JSON.parse(resultJson) as { resultUrls?: unknown };
		return Array.isArray(parsed.resultUrls)
			? parsed.resultUrls.filter(
					(url): url is string => typeof url === "string",
				)
			: [];
	} catch {
		return [];
	}
}

/**
 * `GET /api/v1/jobs/recordInfo?taskId=` — the source of truth for a task's
 * status and results. Callbacks are a trigger only; always re-fetch this
 * before acting on a completion (docs/video-engine-architecture.md §3, §9)
 * — result URLs expire (~24h worst case per kie.ai, conflictingly
 * documented as up to 14d), so ingest to R2 in the same step that observes
 * `state === "success"`.
 */
export async function getTask(taskId: string): Promise<KieTaskRecord> {
	const envelope = await kieFetch<KieRecordInfoData>(
		`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
		{ method: "GET" },
		taskId,
	);

	return {
		taskId: envelope.data.taskId,
		model: envelope.data.model,
		state: envelope.data.state,
		resultUrls: parseResultUrls(envelope.data.resultJson),
		failCode: envelope.data.failCode || undefined,
		failMsg: envelope.data.failMsg || undefined,
		creditsConsumed: envelope.data.creditsConsumed,
		createTime: envelope.data.createTime,
		completeTime: envelope.data.completeTime,
	};
}
