"use client";

import { useMemo } from "react";

import { useProject } from "@/feature/studio/hooks/http/use-project";
import type { OrderedScene } from "@/feature/studio/stores/draft-store";
import { useDraftStore } from "@/feature/studio/stores/draft-store-provider";

/**
 * Composite accessor every Studio panel reads from. `assets`/`versions` are
 * NEVER locally edited (purely generation-driven, read-only history), so
 * they're read straight off the polled `projects.get` query instead of being
 * duplicated into the draft store — `useProject` shares its cache with
 * `DraftStoreProvider`'s own `ProjectSync`, so this is not a second network
 * call. Everything else (`project`, `scenesById`, `timeline`,
 * `subtitleStyle`, undo/redo, edit actions) is its own `useDraftStore`
 * selector, so a consumer only re-renders when the slice it actually reads
 * changes.
 */
export function useStudio() {
	const project = useDraftStore((state) => state.project);
	const scenesById = useDraftStore((state) => state.scenesById);
	const timeline = useDraftStore((state) => state.timeline);
	const subtitleStyle = useDraftStore((state) => state.subtitleStyle);
	const canUndo = useDraftStore((state) => state.past.length > 0);
	const canRedo = useDraftStore((state) => state.future.length > 0);
	const undo = useDraftStore((state) => state.undo);
	const redo = useDraftStore((state) => state.redo);
	const updateSceneField = useDraftStore((state) => state.updateSceneField);
	const reorderTimeline = useDraftStore((state) => state.reorderTimeline);
	const updateSubtitleStyle = useDraftStore(
		(state) => state.updateSubtitleStyle,
	);
	const patchScene = useDraftStore((state) => state.patchScene);
	const removeSceneLocal = useDraftStore((state) => state.removeSceneLocal);
	const applyRestoredTimeline = useDraftStore(
		(state) => state.applyRestoredTimeline,
	);
	const selectedSceneId = useDraftStore((state) => state.selectedSceneId);
	const selectScene = useDraftStore((state) => state.selectScene);

	const { data: detail } = useProject(project.id);

	const orderedScenes = useMemo<OrderedScene[]>(
		() =>
			timeline.flatMap((entry) => {
				const scene = scenesById[entry.sceneId];
				return scene ? [{ entry, scene }] : [];
			}),
		[timeline, scenesById],
	);

	return {
		applyRestoredTimeline,
		assets: detail?.assets ?? [],
		canRedo,
		canUndo,
		orderedScenes,
		patchScene,
		project,
		projectId: project.id,
		redo,
		removeSceneLocal,
		reorderTimeline,
		scenesById,
		selectScene,
		selectedSceneId,
		subtitleStyle,
		timeline,
		undo,
		updateSceneField,
		updateSubtitleStyle,
		versions: detail?.versions ?? [],
	};
}
