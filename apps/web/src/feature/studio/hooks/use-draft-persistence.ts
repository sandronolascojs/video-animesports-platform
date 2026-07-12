"use client";

import { useEffect, useRef } from "react";
import { useStore } from "zustand";

import {
	useUpdateDraftTimeline,
	useUpdateSubtitleStyle,
} from "@/feature/studio/hooks/http/use-project";
import { useUpdateScene } from "@/feature/studio/hooks/http/use-scenes";
import {
	type DraftStore,
	SCENE_TEXT_FIELDS,
	type SceneTextField,
} from "@/feature/studio/stores/draft-store";

/** Trailing debounce after the last edit before a save request fires. */
const DEBOUNCE_MS = 800;

/**
 * Watches the draft store's dirty flags and debounce-persists local edits to
 * the server — the "save" half of the reconcile rule documented on
 * `draft-store.ts`'s `applyServerSnapshot`. One instance per Studio mount,
 * wired from `DraftStoreProvider`.
 *
 * Timeline and subtitle style are single values, so a plain
 * `useEffect([value, dirty])` debounce is enough — a new value reference
 * naturally resets the timer. Scene text is a *keyed* set (N scenes can be
 * dirty independently), so it needs its own per-scene timers that only reset
 * for the scene that actually changed — see the ref-based diff below.
 */
export function useDraftPersistence(store: DraftStore, projectId: string) {
	const timeline = useStore(store, (state) => state.timeline);
	const timelineDirty = useStore(store, (state) => state.timelineDirty);
	const subtitleStyle = useStore(store, (state) => state.subtitleStyle);
	const subtitleStyleDirty = useStore(
		store,
		(state) => state.subtitleStyleDirty,
	);
	const sceneDirtyFields = useStore(store, (state) => state.sceneDirtyFields);
	const scenesById = useStore(store, (state) => state.scenesById);

	const updateDraftTimeline = useUpdateDraftTimeline(projectId);
	const updateSubtitleStyle = useUpdateSubtitleStyle(projectId);
	const updateScene = useUpdateScene(projectId);

	// `updateDraftTimeline`/`store` are stable for this provider's lifetime —
	// only a new timeline value (or the dirty flag) should reset the timer, so
	// they're deliberately left out of the dependency list below.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
	useEffect(() => {
		if (!timelineDirty) {
			return;
		}
		const timeoutId = setTimeout(() => {
			updateDraftTimeline.mutate(
				{ id: projectId, timeline },
				{
					onError: () => store.getState().rollbackTimeline(),
					onSuccess: () => store.getState().markTimelineSynced(timeline),
				},
			);
		}, DEBOUNCE_MS);
		return () => clearTimeout(timeoutId);
	}, [timeline, timelineDirty, projectId]);

	// Same reasoning as the timeline effect above — `updateSubtitleStyle`/
	// `store` intentionally excluded.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
	useEffect(() => {
		if (!subtitleStyleDirty) {
			return;
		}
		const timeoutId = setTimeout(() => {
			updateSubtitleStyle.mutate(
				{ id: projectId, subtitleStyle },
				{
					onError: () => store.getState().rollbackSubtitleStyle(),
					onSuccess: () =>
						store.getState().markSubtitleStyleSynced(subtitleStyle),
				},
			);
		}, DEBOUNCE_MS);
		return () => clearTimeout(timeoutId);
	}, [subtitleStyle, subtitleStyleDirty, projectId]);

	// Per-scene timers, keyed by sceneId, held in a ref (not state) so
	// resetting ONE scene's timer never touches another scene's — this effect
	// re-runs on every keystroke (its deps are `scenesById`/`sceneDirtyFields`,
	// which change as a whole object on any edit), but a `signature` snapshot
	// per scene means a scene whose OWN dirty values haven't changed since the
	// last run is skipped entirely, leaving its in-flight timer untouched.
	const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
	const signaturesRef = useRef(new Map<string, string>());

	// `updateScene`/`store` are stable for this provider's lifetime; the
	// timers/signatures refs intentionally persist across renders instead of
	// being recreated.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
	useEffect(() => {
		const timers = timersRef.current;
		const signatures = signaturesRef.current;

		for (const sceneId of [...timers.keys()]) {
			if (!sceneDirtyFields[sceneId]) {
				const timeoutId = timers.get(sceneId);
				if (timeoutId) {
					clearTimeout(timeoutId);
				}
				timers.delete(sceneId);
				signatures.delete(sceneId);
			}
		}

		for (const [sceneId, dirtyFields] of Object.entries(sceneDirtyFields)) {
			const scene = scenesById[sceneId];
			if (!scene) {
				continue;
			}
			const fields = SCENE_TEXT_FIELDS.filter((field) => dirtyFields[field]);
			if (fields.length === 0) {
				continue;
			}
			const signature = fields
				.map((field) => `${field}:${scene[field]}`)
				.join("|");
			if (signatures.get(sceneId) === signature) {
				continue;
			}
			signatures.set(sceneId, signature);

			const existing = timers.get(sceneId);
			if (existing) {
				clearTimeout(existing);
			}
			timers.set(
				sceneId,
				setTimeout(() => {
					const current = store.getState();
					const currentDirty = current.sceneDirtyFields[sceneId];
					const currentScene = current.scenesById[sceneId];
					const currentFields = currentDirty
						? SCENE_TEXT_FIELDS.filter((field) => currentDirty[field])
						: [];
					if (currentFields.length === 0 || !currentScene) {
						return;
					}
					const payload = Object.fromEntries(
						currentFields.map((field) => [field, currentScene[field]]),
					) as Partial<Record<SceneTextField, string>>;
					updateScene.mutate(
						{ id: sceneId, ...payload },
						{
							onSuccess: () =>
								store.getState().markSceneFieldsSynced(sceneId, currentFields),
						},
					);
					timers.delete(sceneId);
					signatures.delete(sceneId);
				}, DEBOUNCE_MS),
			);
		}
	}, [scenesById, sceneDirtyFields]);

	// Unmount cleanup only — the effect above already clears a scene's own
	// timer once it's no longer dirty or once it fires.
	useEffect(() => {
		const timers = timersRef.current;
		return () => {
			for (const timeoutId of timers.values()) {
				clearTimeout(timeoutId);
			}
			timers.clear();
		};
	}, []);
}
