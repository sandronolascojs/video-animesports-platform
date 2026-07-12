import z from "zod";

import { projectStatusSchema } from "./project";
import { sceneStatusSchema } from "./scene";
import { versionStatusSchema } from "./version";

/**
 * The SSE push channel's event shape (RT-3, docs
 * realtime-and-render-lock-v1.md §1.5): a thin delta, never the full
 * `ProjectDetail` — the client's v1 handling is invalidate-on-event (see
 * that doc's client piece + "Non-goals for v1"), not field-patching, so the
 * payload only needs to be specific enough to drive the first-run overlay's
 * live status copy and tell `use-project-events.ts` an event happened.
 * Declared ONCE here — both apps/server (emits, via
 * `lib/notify-project-event.ts`) and apps/web (parses, in
 * `use-project-events.ts`) import this SAME schema, never a redeclared
 * shape on either side.
 */
export const projectEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("scene"),
		projectId: z.string(),
		sceneId: z.string(),
		status: sceneStatusSchema,
		at: z.number(),
	}),
	z.object({
		type: z.literal("project"),
		projectId: z.string(),
		status: projectStatusSchema,
		at: z.number(),
	}),
	z.object({
		type: z.literal("version"),
		projectId: z.string(),
		versionId: z.string(),
		status: versionStatusSchema,
		at: z.number(),
	}),
]);

export type ProjectEvent = z.infer<typeof projectEventSchema>;
