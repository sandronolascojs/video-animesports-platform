import {
	MAX_SCENE_DURATION_SECONDS,
	MIN_SCENE_DURATION_SECONDS,
	SceneStatus,
} from "@video-platform-challenge/types";
import z from "zod";

export const sceneStatusSchema = z.enum([...Object.values(SceneStatus)]);

export const sceneDurationSchema = z
	.number()
	.int()
	.min(MIN_SCENE_DURATION_SECONDS)
	.max(MAX_SCENE_DURATION_SECONDS);

/**
 * A scene's placement inside a timeline. `projects.draft_timeline` (the
 * mutable, single ordering authority) and `project_versions.timeline` (its
 * immutable snapshot) share this EXACT shape — see
 * docs/video-engine-architecture.md §6, §9 and
 * packages/types/src/shapes.ts `TimelineEntry`.
 *
 * Declared ONCE here and reused by schemas/project.ts (draftTimeline) and
 * schemas/version.ts (timeline) — never redeclared.
 */
export const timelineEntrySchema = z.object({
	sceneId: z.string(),
	videoAssetId: z.string(),
	durationSeconds: sceneDurationSchema,
});

export const sceneSchema = z.object({
	id: z.string(),
	projectId: z.string(),
	title: z.string().nullable(),
	prompt: z.string(),
	// Audio-language spoken line, delivered to kie's TTS (docs §5b).
	dialogue: z.string().nullable(),
	// Plan character delivering `dialogue` (fixed-voice casting, docs §5b).
	speakerName: z.string().nullable(),
	// Subtitle-language caption text, burned in at render time (docs §5b).
	subtitleText: z.string().nullable(),
	status: sceneStatusSchema,
	durationSeconds: sceneDurationSchema,
	// Keyframe fencing refs (docs §2) — asset ids, resolve via
	// `assets.getDownloadUrl` for a signed playback/preview URL.
	startKeyframeAssetId: z.string().nullable(),
	endKeyframeAssetId: z.string().nullable(),
	videoAssetId: z.string().nullable(),
	audioAssetId: z.string().nullable(),
	failReason: z.string().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export const updateSceneInputSchema = z.object({
	id: z.string(),
	prompt: z.string().min(1).max(2000).optional(),
	dialogue: z.string().max(500).optional(),
	subtitleText: z.string().max(500).optional(),
	durationSeconds: sceneDurationSchema.optional(),
});

export const retrySceneInputSchema = z.object({
	id: z.string(),
});

export const removeSceneInputSchema = z.object({
	id: z.string(),
});

export const removeSceneOutputSchema = z.object({
	timeline: z.array(timelineEntrySchema),
});

export type SceneStatusValue = z.infer<typeof sceneStatusSchema>;
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type UpdateSceneInput = z.infer<typeof updateSceneInputSchema>;
export type RetrySceneInput = z.infer<typeof retrySceneInputSchema>;
export type RemoveSceneInput = z.infer<typeof removeSceneInputSchema>;
export type RemoveSceneOutput = z.infer<typeof removeSceneOutputSchema>;
