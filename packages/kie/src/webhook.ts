import z from "zod";

import { KieError } from "./errors";

// Route the server Worker exposes for kie.ai callbacks. Kept as a single
// source of truth so the route registration (apps/server, phase 3b) and the
// callBackUrl handed to createTask (see image.ts / video.ts / speech.ts
// callers) never drift apart.
export const KIE_WEBHOOK_PATH = "/webhooks/kie";

/**
 * Builds the callBackUrl kie.ai should POST to, from the server Worker's own
 * public URL. Deliberately NOT a dedicated `KIE_CALLBACK_URL` env var: the
 * server's public URL already exists as `BETTER_AUTH_URL`
 * (packages/infra/alchemy.run.ts), and deriving from it avoids a var that
 * would otherwise have to be kept in sync with it by hand
 * (docs/video-engine-architecture.md §8).
 */
export function buildKieCallbackUrl(serverBaseUrl: string): string {
	return `${serverBaseUrl.replace(/\/+$/, "")}${KIE_WEBHOOK_PATH}`;
}

// ±5 minutes, per docs/video-engine-architecture.md §5d rule 12 (replay
// protection window against a stolen/replayed callback).
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export interface VerifyWebhookSignatureOptions {
	/** kie.ai's task id, taken from the parsed callback body (`data.taskId`). */
	taskId: string;
	/** Raw `X-Webhook-Timestamp` header value (unix seconds, as a string). */
	timestamp: string;
	/** Raw `X-Webhook-Signature` header value (base64-encoded HMAC-SHA256). */
	signature: string;
	/** `KIE_WEBHOOK_SECRET`. */
	secret: string;
	/** Injectable clock for tests; defaults to `Date.now()`. */
	now?: number;
}

/**
 * Verifies a kie.ai webhook callback per the scheme documented at
 * https://docs.kie.ai/common-api/webhook-verification (fetched 2026-07-11 —
 * the internal architecture doc flagged the exact signing string as
 * under-documented, so this was confirmed directly against kie's docs
 * rather than guessed):
 *
 *   signature = Base64(HMAC-SHA256(secret, `${taskId}.${timestampSeconds}`))
 *
 * This signs `taskId + "." + timestamp`, NOT the raw request body — pass
 * the already-parsed `taskId`, not `rawBody`.
 */
export async function verifyWebhookSignature({
	taskId,
	timestamp,
	signature,
	secret,
	now = Date.now(),
}: VerifyWebhookSignatureOptions): Promise<boolean> {
	const timestampSeconds = Number(timestamp);
	if (!Number.isFinite(timestampSeconds)) {
		return false;
	}

	const skewSeconds = Math.abs(now / 1000 - timestampSeconds);
	if (skewSeconds > TIMESTAMP_TOLERANCE_SECONDS) {
		return false;
	}

	const expectedSignature = await signPayload(`${taskId}.${timestamp}`, secret);
	return constantTimeEqual(expectedSignature, signature);
}

async function signPayload(payload: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const digest = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(payload),
	);
	return base64Encode(digest);
}

function base64Encode(digest: ArrayBuffer): string {
	let binary = "";
	for (const byte of new Uint8Array(digest)) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

/**
 * Constant-time string comparison. Hand-rolled over `TextEncoder` bytes
 * rather than `node:crypto`'s `timingSafeEqual`, to keep packages/kie
 * portable across edge runtimes (Workers, Bun) that don't opt into node
 * compat — mirrors packages/storage's pure-Web-API style.
 */
function constantTimeEqual(a: string, b: string): boolean {
	const bytesA = new TextEncoder().encode(a);
	const bytesB = new TextEncoder().encode(b);
	const length = Math.max(bytesA.length, bytesB.length);
	let diff = bytesA.length ^ bytesB.length;
	for (let i = 0; i < length; i++) {
		diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0);
	}
	return diff === 0;
}

/**
 * kie.ai's callback body. The exact shape is under-documented (per
 * docs/video-engine-architecture.md §3) and observably varies across kie's
 * product lines (4o-image nests `result_urls` under `data.info`, veo3 nests
 * camelCase `resultUrls` under `data.info` — checked 2026-07-11); every
 * variant found agrees `data.taskId` holds the task id, except kie's own
 * webhook-verification code sample, which reads `data.task_id` (snake_case)
 * — we accept either defensively. Everything else is treated as an opaque
 * trigger: `getTask` (client.ts, backed by `recordInfo`) is the source of
 * truth, never this payload's `data.info`/result fields.
 */
const kieWebhookPayloadSchema = z
	.object({
		code: z.number().optional(),
		msg: z.string().optional(),
		data: z
			.object({
				taskId: z.string().optional(),
				task_id: z.string().optional(),
			})
			.loose(),
	})
	.loose();

export type KieWebhookPayload = z.infer<typeof kieWebhookPayloadSchema>;

export interface ParsedKieWebhookPayload {
	payload: KieWebhookPayload;
	taskId: string;
}

// Fix-pass W3: `fetchAndPutToR2` (apps/server/src/services/generation.service.ts)
// fetches whatever URL a "successful" `getTask` response hands back and
// streams it into R2 — an allowlist bounds what host that fetch is ever
// allowed to reach, so a compromised/misbehaving kie.ai account (or a
// `recordInfo` response mutated in transit, however unlikely over TLS)
// can't be used to make the server fetch an internal/arbitrary URL
// (SSRF-shaped risk).
//
// VERIFICATION LIMITATION (documented per this fix pass, not silently
// guessed): kie.ai's own docs (docs.kie.ai/common-api/quickstart, fetched
// 2026-07-11) show only a REDACTED example result host
// (`tempfile.1f6cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxbd98`) — the real base
// domain behind that redaction could not be confirmed from public docs
// during this pass. This list is deliberately narrow (fails CLOSED, not
// open) and should be widened the first time a real production callback
// payload's resultUrl host is observed and confirmed.
export const KIE_RESULT_URL_HOST_ALLOWLIST: readonly string[] = [
	"kie.ai",
	// Best-effort inclusion pending the verification above — kie.ai's
	// generated-file hosting has been associated with this domain; confirm
	// against a real payload before relying on it.
	"aiquickdraw.com",
];

/**
 * True when `url` is `https:` AND its hostname is exactly one of
 * `KIE_RESULT_URL_HOST_ALLOWLIST`, or a subdomain of one (fix-pass W3).
 * Malformed URLs are rejected (false), never thrown.
 */
export function isAllowedResultUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== "https:") {
		return false;
	}
	const hostname = parsed.hostname.toLowerCase();
	return KIE_RESULT_URL_HOST_ALLOWLIST.some(
		(domain) => hostname === domain || hostname.endsWith(`.${domain}`),
	);
}

/**
 * Parses + validates a kie.ai webhook body and extracts the task id. Throws
 * `KieError` (status 400, fatal — malformed payloads should not be retried)
 * on invalid JSON, schema mismatch, or a missing task id.
 */
export function parseKieWebhookPayload(
	rawBody: string,
): ParsedKieWebhookPayload {
	let json: unknown;
	try {
		json = JSON.parse(rawBody);
	} catch (cause) {
		throw new KieError("Webhook payload is not valid JSON", {
			status: 400,
			cause,
		});
	}

	const result = kieWebhookPayloadSchema.safeParse(json);
	if (!result.success) {
		throw new KieError("Webhook payload failed schema validation", {
			status: 400,
			cause: result.error,
		});
	}

	const taskId = result.data.data.taskId ?? result.data.data.task_id;
	if (!taskId) {
		throw new KieError("Webhook payload is missing a taskId", { status: 400 });
	}

	return { payload: result.data, taskId };
}
