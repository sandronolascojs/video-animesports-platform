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

/**
 * One real, speech-timed subtitle cue — structurally mirrors packages/types
 * `SpeechCue` exactly (same parallel-declaration convention as
 * `subtitleStyleSchema`/`SubtitleStyle` in schemas/project.ts). Populated by
 * the server's kie Scribe STT step; see `sceneSchema.speechCues`'s own doc
 * comment for the full story.
 */
export const speechCueSchema = z.object({
	text: z.string(),
	startSeconds: z.number(),
	endSeconds: z.number(),
});

export const sceneSchema = z.object({
	id: z.string(),
	projectId: z.string(),
	title: z.string().nullable(),
	prompt: z.string(),
	// Audio-language spoken line — Seedance speaks it natively in the scene
	// video (docs studio-fixes-backlog.md).
	dialogue: z.string().nullable(),
	// Plan character delivering `dialogue` — surfaced in the video prompt.
	speakerName: z.string().nullable(),
	// Subtitle-language caption text, burned in at render time (docs §5b).
	subtitleText: z.string().nullable(),
	// Real, speech-timed cues from kie's ElevenLabs Scribe STT (docs
	// media-ops-container.md Feature 2) — null until the best-effort STT step
	// runs/succeeds for this scene (or the scene has no dialogue/subtitle to
	// transcribe). `apps/web`'s subtitle-cues.ts prefers these VERBATIM over
	// its own word-count estimate whenever they're present.
	speechCues: z.array(speechCueSchema).nullable(),
	status: sceneStatusSchema,
	durationSeconds: sceneDurationSchema,
	// Keyframe fencing refs (docs §2) — asset ids, resolve via
	// `assets.getProjectUrls` for a signed playback/preview URL.
	startKeyframeAssetId: z.string().nullable(),
	endKeyframeAssetId: z.string().nullable(),
	videoAssetId: z.string().nullable(),
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
export type SpeechCue = z.infer<typeof speechCueSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type UpdateSceneInput = z.infer<typeof updateSceneInputSchema>;
export type RetrySceneInput = z.infer<typeof retrySceneInputSchema>;
export type RemoveSceneInput = z.infer<typeof removeSceneInputSchema>;
export type RemoveSceneOutput = z.infer<typeof removeSceneOutputSchema>;
