import type {
	Project,
	ProjectDetail,
	Scene,
	SubtitleStyle,
	TimelineEntry,
} from "@video-platform-challenge/api";
import { createStore } from "zustand";

/**
 * Client-editable scene text fields — the ONLY `scenes.update` input fields a
 * user edits by hand in v1 (docs/studio-ui.md §1 "Assets & Scenes panel").
 * `title` is deliberately excluded: `sceneSchema.title` is agent-assigned
 * (plan/extend step), not part of `updateSceneInputSchema`, and no v1 view
 * renders it as editable.
 */
export type SceneTextField = "prompt" | "dialogue" | "subtitleText";

const SCENE_TEXT_FIELDS = [
	"prompt",
	"dialogue",
	"subtitleText",
] as const satisfies readonly SceneTextField[];

export type OrderedScene = { entry: TimelineEntry; scene: Scene };

/** Client-side default — `projects.subtitle_style` is `null` until the user (or the plan agent, later) sets one. `lineHeight`/`maxWidthPercent` match the values `SubtitleOverlay`/`drawSubtitle` already hardcoded before the controls existed (1.2, 90%) — `textShadow` defaults off since the outline stroke already guarantees legibility. */
export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
	backgroundColor: "rgba(0, 0, 0, 0.55)",
	color: "#ffffff",
	font: "Inter",
	fontSize: 48,
	lineHeight: 1.2,
	maxWidthPercent: 90,
	outlineColor: "#000000",
	position: "bottom",
	textShadow: false,
	textShadowIntensity: 50,
	weight: "medium",
};

/** The undo/redo-tracked slice of the project (docs/studio-ui.md "Draft state"). */
export type DraftSnapshot = {
	scenesById: Record<string, Scene>;
	timeline: TimelineEntry[];
	subtitleStyle: SubtitleStyle;
};

/** Which fields of a scene have a local edit not yet confirmed saved. */
export type SceneDirtyFields = Partial<Record<SceneTextField, true>>;

export type DraftStoreState = DraftSnapshot & {
	/** Read-only project fields (status, failReason, title...) — always fresh from the last poll, never locally edited. */
	project: Project;

	/** Scene highlighted by clicking a timeline clip or a scenes-panel row (docs' timeline requirement 4) — pure UI state, deliberately NOT part of `DraftSnapshot`/undo-redo. */
	selectedSceneId: string | null;
	selectScene: (sceneId: string | null) => void;

	past: DraftSnapshot[];
	future: DraftSnapshot[];

	// ---- Reconcile-rule bookkeeping (see applyServerSnapshot's doc comment) ----
	timelineDirty: boolean;
	subtitleStyleDirty: boolean;
	sceneDirtyFields: Record<string, SceneDirtyFields>;
	/** Last value confirmed persisted — what a failed save rolls back to. */
	confirmedTimeline: TimelineEntry[];
	confirmedSubtitleStyle: SubtitleStyle;

	// ---- User-triggered edits (optimistic, mark dirty) ----
	updateSceneField: (
		sceneId: string,
		field: SceneTextField,
		value: string,
	) => void;
	reorderTimeline: (timeline: TimelineEntry[]) => void;
	updateSubtitleStyle: (patch: Partial<SubtitleStyle>) => void;
	undo: () => void;
	redo: () => void;

	// ---- Server-confirmed writes (apply immediately, not dirty) ----
	patchScene: (scene: Scene) => void;
	removeSceneLocal: (sceneId: string, timeline: TimelineEntry[]) => void;
	/** History panel's Restore: applies a version's timeline, marks it dirty so the debounced persist saves it back (docs' restore flow). */
	applyRestoredTimeline: (timeline: TimelineEntry[]) => void;
	applyServerSnapshot: (detail: ProjectDetail) => void;

	// ---- Persistence-hook callbacks (feature/studio/hooks/use-draft-persistence.ts) ----
	markTimelineSynced: (timeline: TimelineEntry[]) => void;
	rollbackTimeline: () => void;
	markSubtitleStyleSynced: (style: SubtitleStyle) => void;
	rollbackSubtitleStyle: () => void;
	markSceneFieldsSynced: (sceneId: string, fields: SceneTextField[]) => void;
};

/**
 * Copies one text field from `source` onto `target`. A generic
 * `target[field] = source[field]` (looping `field` over the `SceneTextField`
 * union) doesn't type-check: TS can't prove the value read for a UNION key is
 * assignable back to the same union key's slot (a well-known indexed-access
 * limitation), even though every individual case is obviously sound. An
 * explicit switch sidesteps it without a cast.
 */
function copySceneTextField(
	target: Scene,
	source: Scene,
	field: SceneTextField,
) {
	switch (field) {
		case "prompt":
			target.prompt = source.prompt;
			return;
		case "dialogue":
			target.dialogue = source.dialogue;
			return;
		case "subtitleText":
			target.subtitleText = source.subtitleText;
			return;
	}
}

function snapshot(state: DraftSnapshot): DraftSnapshot {
	return {
		scenesById: state.scenesById,
		subtitleStyle: state.subtitleStyle,
		timeline: state.timeline,
	};
}

export type DraftStore = ReturnType<typeof createDraftStore>;

/**
 * Per-project Studio draft store (docs/studio-ui.md "Client state rule" +
 * "Draft state"): a zustand vanilla store, one instance per `StudioView`
 * mount (see `draft-store-provider.tsx`) — NOT a global singleton, since
 * every project needs its own draft + undo stack.
 *
 * Reconcile rule (server echo vs. local edits — front-wiring phase 1): the
 * store tracks which fields are "dirty" (locally edited, not yet confirmed
 * saved). `applyServerSnapshot` — called from the Provider every time the
 * polled `projects.get` query resolves with new data — overwrites
 * everything EXCEPT dirty fields, which keep their local value until the
 * corresponding debounced mutation succeeds (`markXSynced`, called from
 * `use-draft-persistence.ts`) and the next snapshot can safely take over
 * again. Concretely: scene status/assets/failReason, project status, and any
 * OTHER scene's text always update live from polling — only the exact
 * field(s) the user is mid-editing are protected. On a failed timeline/style
 * save, the store rolls back to the last confirmed value (the mutation
 * itself already surfaced a toast via `toastMutationError`); a failed
 * scene-text save is left dirty instead — it keeps protecting the unsaved
 * edit and is retried by the next edit, rather than yanking text out from
 * under the user mid-typing.
 *
 * Undo/redo (`past`/`future`) only tracks USER edits (`updateSceneField`,
 * `reorderTimeline`, `updateSubtitleStyle`) via the shared `mutate` helper —
 * server-confirmed writes (`patchScene`, `applyServerSnapshot`, ...) call
 * `set` directly so a poll tick or another tab's edit never becomes an undo
 * step.
 */
export function createDraftStore(detail: ProjectDetail) {
	const initialSubtitleStyle = detail.subtitleStyle ?? DEFAULT_SUBTITLE_STYLE;

	return createStore<DraftStoreState>()((set, get) => {
		/**
		 * Runs `mutator` against the current snapshot and commits it as a new
		 * undo checkpoint. Returns `false` (no-op, e.g. an unknown sceneId — the
		 * mutator returned the same reference) without touching state, so
		 * callers know whether to also flip the matching dirty flag.
		 */
		function mutate(mutator: (draft: DraftSnapshot) => DraftSnapshot): boolean {
			const before = snapshot(get());
			const after = mutator(before);
			if (after === before) {
				return false;
			}
			set({ ...after, future: [], past: [...get().past, before] });
			return true;
		}

		return {
			applyRestoredTimeline: (timeline) =>
				set({ timeline, timelineDirty: true }),

			applyServerSnapshot: (detail) =>
				set((state) => {
					const nextScenesById: Record<string, Scene> = {};
					for (const serverScene of detail.scenes) {
						const dirtyFields = state.sceneDirtyFields[serverScene.id];
						const localScene = state.scenesById[serverScene.id];
						if (dirtyFields && localScene) {
							const merged: Scene = { ...serverScene };
							for (const field of Object.keys(
								dirtyFields,
							) as SceneTextField[]) {
								copySceneTextField(merged, localScene, field);
							}
							nextScenesById[serverScene.id] = merged;
						} else {
							nextScenesById[serverScene.id] = serverScene;
						}
					}

					const serverSubtitleStyle =
						detail.subtitleStyle ?? DEFAULT_SUBTITLE_STYLE;

					return {
						confirmedSubtitleStyle: serverSubtitleStyle,
						confirmedTimeline: detail.draftTimeline,
						project: detail,
						scenesById: nextScenesById,
						subtitleStyle: state.subtitleStyleDirty
							? state.subtitleStyle
							: serverSubtitleStyle,
						timeline: state.timelineDirty
							? state.timeline
							: detail.draftTimeline,
					};
				}),

			confirmedSubtitleStyle: initialSubtitleStyle,
			confirmedTimeline: detail.draftTimeline,
			future: [],

			markSceneFieldsSynced: (sceneId, fields) =>
				set((state) => {
					const existing = state.sceneDirtyFields[sceneId];
					if (!existing) {
						return state;
					}
					const nextFields = { ...existing };
					for (const field of fields) {
						delete nextFields[field];
					}
					const nextDirty = { ...state.sceneDirtyFields };
					if (Object.keys(nextFields).length > 0) {
						nextDirty[sceneId] = nextFields;
					} else {
						delete nextDirty[sceneId];
					}
					return { sceneDirtyFields: nextDirty };
				}),

			markSubtitleStyleSynced: (style) =>
				set({ confirmedSubtitleStyle: style, subtitleStyleDirty: false }),

			markTimelineSynced: (timeline) =>
				set({ confirmedTimeline: timeline, timelineDirty: false }),

			past: [],

			patchScene: (scene) =>
				set((state) => ({
					scenesById: { ...state.scenesById, [scene.id]: scene },
				})),

			project: detail,

			redo: () => {
				const { future, past } = get();
				const next = future[0];
				if (!next) {
					return;
				}
				set({
					...next,
					future: future.slice(1),
					past: [...past, snapshot(get())],
				});
			},

			removeSceneLocal: (sceneId, timeline) =>
				set((state) => {
					const nextScenes = { ...state.scenesById };
					delete nextScenes[sceneId];
					const nextDirtyFields = { ...state.sceneDirtyFields };
					delete nextDirtyFields[sceneId];
					return {
						confirmedTimeline: timeline,
						scenesById: nextScenes,
						sceneDirtyFields: nextDirtyFields,
						selectedSceneId:
							state.selectedSceneId === sceneId ? null : state.selectedSceneId,
						timeline,
						timelineDirty: false,
					};
				}),

			reorderTimeline: (timeline) => {
				if (mutate((draft) => ({ ...draft, timeline }))) {
					set({ timelineDirty: true });
				}
			},

			rollbackSubtitleStyle: () =>
				set((state) => ({
					subtitleStyle: state.confirmedSubtitleStyle,
					subtitleStyleDirty: false,
				})),

			rollbackTimeline: () =>
				set((state) => ({
					timeline: state.confirmedTimeline,
					timelineDirty: false,
				})),

			scenesById: Object.fromEntries(
				detail.scenes.map((scene) => [scene.id, scene] as const),
			),
			sceneDirtyFields: {},

			selectScene: (sceneId) => set({ selectedSceneId: sceneId }),
			selectedSceneId: null,

			subtitleStyle: initialSubtitleStyle,
			subtitleStyleDirty: false,

			timeline: detail.draftTimeline,
			timelineDirty: false,

			undo: () => {
				const { future, past } = get();
				const previous = past.at(-1);
				if (!previous) {
					return;
				}
				set({
					...previous,
					future: [snapshot(get()), ...future],
					past: past.slice(0, -1),
				});
			},

			updateSceneField: (sceneId, field, value) => {
				const applied = mutate((draft) => {
					const scene = draft.scenesById[sceneId];
					if (!scene) {
						return draft;
					}
					return {
						...draft,
						scenesById: {
							...draft.scenesById,
							[sceneId]: { ...scene, [field]: value },
						},
					};
				});
				if (applied) {
					set((state) => ({
						sceneDirtyFields: {
							...state.sceneDirtyFields,
							[sceneId]: { ...state.sceneDirtyFields[sceneId], [field]: true },
						},
					}));
				}
			},

			updateSubtitleStyle: (patch) => {
				const applied = mutate((draft) => ({
					...draft,
					subtitleStyle: { ...draft.subtitleStyle, ...patch },
				}));
				if (applied) {
					set({ subtitleStyleDirty: true });
				}
			},
		};
	});
}

/** All fields `updateSceneField` may target — used by the persistence hook to read back dirty values. */
export { SCENE_TEXT_FIELDS };
