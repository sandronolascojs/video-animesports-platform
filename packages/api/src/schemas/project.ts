import {
	AspectRatio,
	AudioLanguage,
	INITIAL_SCENE_COUNT,
	MAX_SCENES_PER_GENERATION,
	MIN_SCENES_PER_GENERATION,
	ProjectStatus,
	SubtitleLanguage,
	TemplateKey,
} from "@video-platform-challenge/types";
import z from "zod";

import { assetSchema } from "./asset";
import { sceneSchema, timelineEntrySchema } from "./scene";
import { versionSchema } from "./version";

export const projectStatusSchema = z.enum([...Object.values(ProjectStatus)]);
export const templateKeySchema = z.enum([...Object.values(TemplateKey)]);
export const aspectRatioSchema = z.enum([...Object.values(AspectRatio)]);
export const audioLanguageSchema = z.enum([...Object.values(AudioLanguage)]);
export const subtitleLanguageSchema = z.enum([
	...Object.values(SubtitleLanguage),
]);

/**
 * `projects.subtitle_style` — drives both the Remotion Player overlay (live
 * preview) and the ASS track compiled at render/burn-in time (docs §5b).
 * Structurally mirrors packages/types `SubtitleStyle` exactly. Declared
 * ONCE here and reused by `updateSubtitleStyle`'s input AND the project
 * output — never redeclared.
 *
 * `lineHeight`/`maxWidthPercent`/`textShadow`/`textShadowIntensity` (studio
 * quality pass §3, controls-only — no per-cue timing) extend the original
 * size/weight/color/outline/background/position set. Both `composition.tsx`'s
 * `SubtitleOverlay` (live Player) and `subtitle-canvas.ts`'s `drawSubtitle`
 * (export burn-in) fall back to their previous hardcoded values when these
 * are unset, so existing projects (and the `null` `subtitleStyle` default)
 * render byte-identical to before this change.
 */
export const subtitleStyleSchema = z.object({
	font: z.string().optional(),
	fontSize: z.number().positive().optional(),
	weight: z.string().optional(),
	color: z.string().optional(),
	outlineColor: z.string().optional(),
	backgroundColor: z.string().optional(),
	position: z.string().optional(),
	/** Multiplier over `fontSize`, e.g. `1.2` — mirrors CSS `line-height`'s unitless form. */
	lineHeight: z.number().positive().optional(),
	/** Percent (1-100) of the safe content box — mirrors the overlay's `maxWidth: "N%"`. */
	maxWidthPercent: z.number().min(1).max(100).optional(),
	/** Drop-shadow toggle, independent of the always-on outline stroke. */
	textShadow: z.boolean().optional(),
	/** Percent (0-100) driving the shadow's blur radius + opacity when `textShadow` is on. */
	textShadowIntensity: z.number().min(0).max(100).optional(),
});

// The user's main story description — the core creation input (docs §1).
// Bounds are this contract's own choice (not doc-specified): long enough for
// a real scene premise, short enough to cap agent/provider cost exposure.
export const projectDescriptionSchema = z.string().min(10).max(2000);

export const projectSchema = z.object({
	id: z.string(),
	templateKey: templateKeySchema,
	description: z.string(),
	// title/synopsis are agent-assigned once the plan step runs — null
	// until then.
	title: z.string().nullable(),
	synopsis: z.string().nullable(),
	status: projectStatusSchema,
	// Chosen at creation; immutable by convention thereafter (docs §5c.5) —
	// no update procedure in this contract ever touches it.
	aspectRatio: aspectRatioSchema,
	audioLanguage: audioLanguageSchema,
	subtitleLanguage: subtitleLanguageSchema,
	// Fixed style-token text block produced once by the plan agent (docs
	// §2) — null until the plan step runs.
	styleBible: z.string().nullable(),
	subtitleStyle: subtitleStyleSchema.nullable(),
	// THE only scene-ordering authority (docs §6, §9) — scenes carry no
	// sort column.
	draftTimeline: z.array(timelineEntrySchema),
	// Set when generation fails at the project level (docs §5c.1) — mirrors
	// scenes/assets/project_versions' own failReason field.
	failReason: z.string().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

/**
 * Lean list-row shape — NOT the full `projectSchema` (list renders cards,
 * not the Studio).
 */
export const projectSummarySchema = z.object({
	id: z.string(),
	title: z.string().nullable(),
	status: projectStatusSchema,
	templateKey: templateKeySchema,
	aspectRatio: aspectRatioSchema,
	createdAt: z.date(),
	// First ready keyframe/character-sheet asset, used as the card
	// thumbnail; null until the project has produced at least one asset.
	thumbnailAssetId: z.string().nullable(),
});

/**
 * Full detail: project row + scenes + assets + versions. This is the
 * Studio's polling surface for the generating state — it must carry enough
 * for the Studio to render the storyboard, canvas, timeline, and history
 * panel without any extra round-trips.
 */
export const projectDetailSchema = projectSchema.extend({
	scenes: z.array(sceneSchema),
	assets: z.array(assetSchema),
	versions: z.array(versionSchema),
});

export const createProjectInputSchema = z.object({
	description: projectDescriptionSchema,
	templateKey: templateKeySchema.optional(),
	aspectRatio: aspectRatioSchema,
	audioLanguage: audioLanguageSchema,
	subtitleLanguage: subtitleLanguageSchema,
	// Composer's scenes dropdown: how many scenes the initial generation
	// plans (default INITIAL_SCENE_COUNT, bounded MIN..MAX per generation).
	sceneCount: z
		.number()
		.int()
		.min(MIN_SCENES_PER_GENERATION)
		.max(MAX_SCENES_PER_GENERATION)
		.default(INITIAL_SCENE_COUNT),
});

// Simple limit/offset pagination (not cursor-based): the projects list is a
// single-tenant, low-cardinality collection (one user's own projects) with
// no infinite-scroll requirement in the current UI (docs/studio-ui.md §0
// "Recent projects" is a bounded grid) — offset pagination is simplest and
// sufficient. Revisit with a cursor if the list ever needs stable pagination
// under concurrent inserts.
export const listProjectsInputSchema = z.object({
	limit: z.number().int().min(1).max(50).default(20),
	offset: z.number().int().min(0).default(0),
});

export const listProjectsOutputSchema = z.array(projectSummarySchema);

export const getProjectInputSchema = z.object({
	id: z.string(),
});

export const updateDraftTimelineInputSchema = z.object({
	id: z.string(),
	timeline: z.array(timelineEntrySchema),
});

export const updateSubtitleStyleInputSchema = z.object({
	id: z.string(),
	subtitleStyle: subtitleStyleSchema,
});

export const updateLanguagesInputSchema = z.object({
	id: z.string(),
	audioLanguage: audioLanguageSchema.optional(),
	subtitleLanguage: subtitleLanguageSchema.optional(),
});

// Optional user guidance for the new scene ("add a scene where the crowd
// goes silent") — the extendStory agent shape (docs §7) always receives the
// story-so-far as context regardless of whether this is provided.
export const extendProjectInputSchema = z.object({
	id: z.string(),
	prompt: z.string().min(1).max(2000).optional(),
	// Studio dock's scenes dropdown: how many scenes this extension adds
	// (the extend agent runs once per scene, chaining keyframes).
	sceneCount: z
		.number()
		.int()
		.min(MIN_SCENES_PER_GENERATION)
		.max(MAX_SCENES_PER_GENERATION)
		.default(1),
});

export const deleteProjectInputSchema = z.object({
	id: z.string(),
});

export type ProjectStatusValue = z.infer<typeof projectStatusSchema>;
export type TemplateKeyValue = z.infer<typeof templateKeySchema>;
export type AspectRatioValue = z.infer<typeof aspectRatioSchema>;
export type AudioLanguageValue = z.infer<typeof audioLanguageSchema>;
export type SubtitleLanguageValue = z.infer<typeof subtitleLanguageSchema>;
export type SubtitleStyle = z.infer<typeof subtitleStyleSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
/**
 * The schema's INPUT side (`z.input`) — differs from `CreateProjectInput`
 * (the parsed output) because `sceneCount` carries a `.default()`: optional
 * going in, guaranteed number coming out. Form state (react-hook-form's
 * `TFieldValues` with `zodResolver`) binds to THIS type; submit handlers
 * receive the output type. Exported so the web app never re-derives it with
 * its own `z.input<...>` duplicate.
 */
export type CreateProjectFormInput = z.input<typeof createProjectInputSchema>;
export type ListProjectsInput = z.infer<typeof listProjectsInputSchema>;
export type GetProjectInput = z.infer<typeof getProjectInputSchema>;
export type UpdateDraftTimelineInput = z.infer<
	typeof updateDraftTimelineInputSchema
>;
export type UpdateSubtitleStyleInput = z.infer<
	typeof updateSubtitleStyleInputSchema
>;
export type UpdateLanguagesInput = z.infer<typeof updateLanguagesInputSchema>;
export type ExtendProjectInput = z.infer<typeof extendProjectInputSchema>;
export type DeleteProjectInput = z.infer<typeof deleteProjectInputSchema>;
