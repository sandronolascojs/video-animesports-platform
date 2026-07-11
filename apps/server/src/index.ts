import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ORPCError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { customJsonSerializers } from "@video-platform-challenge/api";
import { createAuth } from "@video-platform-challenge/auth";
import { env } from "@video-platform-challenge/env/server";
import { KIE_WEBHOOK_PATH } from "@video-platform-challenge/kie";
import type { UIMessage } from "ai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import {
	agentChatRequestBodySchema,
	MAX_AGENT_CHAT_BODY_BYTES,
} from "./lib/agent-chat-request";
import { createContext } from "./lib/context";
import * as generationTaskRepository from "./repositories/generation-task.repository";
import { appRouter } from "./routers";
import { buildStudioChat } from "./services/agent-chat.service";
import { handleKieWebhook } from "./services/generation-webhook.service";
import { VideoGenerationWorkflow } from "./workflows/video-generation";

// Re-exported (not just defined) so the compiled worker script exposes it as
// a named export — the VIDEO_GENERATION_WORKFLOW binding in
// packages/infra/alchemy.run.ts resolves this class by `className` off this
// entrypoint module.
export { VideoGenerationWorkflow };

const app = new Hono();

app.use(logger());
app.use(
	"/*",
	cors({
		origin: env.CORS_ORIGIN,
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		credentials: true,
	}),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => createAuth().handler(c.req.raw));

// kie.ai webhook — thin route wiring; the branching logic (auth, body-size
// bounds, payload parsing, task lookup, workflow sendEvent) lives in
// services/generation-webhook.service.ts (fix-pass W9c) so it stays
// unit-testable and this route stays a thin mapping to HTTP, like an oRPC
// router. See that file's doc comment for the full behavior matrix.
//
// Unused with the challenge API key: kie callbacks require webhook config we
// don't have, so no callBackUrl is ever handed to a kie.ai createTask call
// and this route never receives real traffic — every task's completion is
// discovered by polling instead (workflows/video-generation.ts's
// `waitForKieTask`). Kept wired and tested (HMAC verification included) for
// a future key with callback access.
app.post(KIE_WEBHOOK_PATH, async (c) => {
	const contentLengthHeader = c.req.header("Content-Length");
	const result = await handleKieWebhook({
		timestamp: c.req.header("X-Webhook-Timestamp"),
		signature: c.req.header("X-Webhook-Signature"),
		contentLength: contentLengthHeader
			? Number(contentLengthHeader)
			: undefined,
		readBody: () => c.req.text(),
		webhookSecret: env.KIE_WEBHOOK_SECRET,
		findTaskByKieTaskId: generationTaskRepository.findByKieTaskId,
		getWorkflowInstance: (instanceId) =>
			env.VIDEO_GENERATION_WORKFLOW.get(instanceId),
	});
	return c.text(result.message, result.status);
});

// Studio agent chat — a raw Hono route next to `/rpc`, not an oRPC procedure
// (docs ai-architecture-v1.md §2 "Transport"): it needs to return an AI SDK
// UI-message STREAM response directly, which oRPC's JSON-envelope handlers
// don't support. Same session auth as `/rpc` (createContext extracts the
// Better Auth cookie session the same way); CORS is already covered by the
// blanket `cors()` middleware registered on `"/*"` above, so no separate
// config is needed here. Body = AI SDK `useChat`'s default transport payload
// (`{ id, messages, trigger, messageId }`) — only `messages` is used.
app.post("/agent/:projectId/chat", async (c) => {
	const { session } = await createContext({ context: c });
	if (!session?.user) {
		return c.text("Unauthorized", 401);
	}

	// Body-size bound (docs §8a fix 6, mirrors the kie webhook route's
	// pre-auth-hardening bound pattern above): reject on the declared
	// Content-Length first, then re-check the actual body once read (a header
	// can be absent/spoofed).
	const contentLengthHeader = c.req.header("Content-Length");
	if (
		contentLengthHeader !== undefined &&
		Number(contentLengthHeader) > MAX_AGENT_CHAT_BODY_BYTES
	) {
		return c.text("Payload Too Large", 413);
	}
	const rawBody = await c.req.text();
	if (rawBody.length > MAX_AGENT_CHAT_BODY_BYTES) {
		return c.text("Payload Too Large", 413);
	}

	let parsedBody: unknown;
	try {
		parsedBody = JSON.parse(rawBody);
	} catch {
		return c.text("Bad Request", 400);
	}
	const bodyResult = agentChatRequestBodySchema.safeParse(parsedBody);
	if (!bodyResult.success) {
		return c.text("Bad Request", 400);
	}
	// The zod schema above is a light boundary check (id/role/parts shape),
	// not a full UIMessage re-model — `parsedBody` (not `bodyResult.data`) is
	// what flows onward so every other field a real UIMessage carries
	// (metadata, etc.) survives untouched.
	const projectId = c.req.param("projectId");
	const body = parsedBody as { messages: UIMessage[] };

	let chat: Awaited<ReturnType<typeof buildStudioChat>>;
	try {
		chat = await buildStudioChat({
			session,
			projectId,
			messages: body.messages,
		});
	} catch (error) {
		if (error instanceof ORPCError && error.code === "NOT_FOUND") {
			return c.text("Not Found", 404);
		}
		if (error instanceof ORPCError && error.code === "RATE_LIMITED") {
			return c.text("Too Many Requests", 429);
		}
		throw error;
	}

	// Persistence (docs §2): the incoming latest user message was already
	// persisted inside `buildStudioChat`; the assistant's finished turn is
	// persisted here via `onFinish`'s `responseMessage` — the exact UIMessage
	// (parts included) that gets streamed back to the client.
	return chat.result.toUIMessageStreamResponse({
		originalMessages: body.messages,
		onFinish: async ({ responseMessage }) => {
			await chat.persistAssistantMessage(responseMessage);
		},
		// docs §8a fix 2: log the real error server-side, never leak internal
		// details (provider errors, stack traces) to the client — the stream
		// carries only this short generic string.
		onError: (error) => {
			console.error(
				`[agent-chat] stream error for project ${projectId}`,
				error,
			);
			return "The agent hit an error — try again.";
		},
	});
});

export const apiHandler = new OpenAPIHandler(appRouter, {
	customJsonSerializers,
	plugins: [
		new OpenAPIReferencePlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
		}),
	],
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});

export const rpcHandler = new RPCHandler(appRouter, {
	customJsonSerializers,
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});

app.use("/*", async (c, next) => {
	const context = await createContext({ context: c });

	const rpcResult = await rpcHandler.handle(c.req.raw, {
		prefix: "/rpc",
		context: context,
	});

	if (rpcResult.matched) {
		return c.newResponse(rpcResult.response.body, rpcResult.response);
	}

	const apiResult = await apiHandler.handle(c.req.raw, {
		prefix: "/api-reference",
		context: context,
	});

	if (apiResult.matched) {
		return c.newResponse(apiResult.response.body, apiResult.response);
	}

	await next();
});

app.get("/", (c) => {
	return c.text("OK");
});

export default app;
