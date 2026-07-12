"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { orpc } from "@/libs/orpc";
import { toastMutationError } from "@/libs/orpc/mutation-error";

function projectQueryKey(projectId: string) {
	return orpc.projects.get.queryOptions({ input: { id: projectId } }).queryKey;
}

/**
 * Scene text-field persist (prompt/dialogue/subtitleText) — called from
 * `feature/studio/hooks/use-draft-persistence.ts` on a per-scene debounce,
 * never directly from a component (edits apply to the draft store
 * optimistically; this is the "save" half). A manual edit marks the scene's
 * existing assets stale server-side but never regenerates them automatically
 * (docs/studio-ui.md §2).
 */
export function useUpdateScene(projectId: string) {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.scenes.update.mutationOptions({
			onError: (error) => {
				toastMutationError(error, { title: "Couldn't save scene" });
			},
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: projectQueryKey(projectId) });
			},
		}),
	);
}

/**
 * Per-scene Retry (docs/studio-ui.md §1 "Failure states"). `CONFLICT` (scene
 * isn't currently `failed` — e.g. a second click while the first retry is
 * already in flight) gets friendlier copy than the raw contract message.
 */
export function useRetryScene(projectId: string) {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.scenes.retry.mutationOptions({
			onError: (error) => {
				toastMutationError(error, {
					codeMessages: {
						CONFLICT: "This scene is already generating.",
						RATE_LIMITED:
							"You've hit the hourly generation limit. Try again in a bit.",
					},
					title: "Couldn't retry scene",
				});
			},
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: projectQueryKey(projectId) });
			},
		}),
	);
}

/**
 * Timeline strip's delete action (docs/studio-ui.md §1 "Timeline"). The
 * server drops any timeline entries referencing the removed scene and
 * returns the corrected timeline — the caller applies it straight to the
 * draft store instead of waiting on the next poll for a snappier delete.
 */
export function useRemoveScene(projectId: string) {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.scenes.remove.mutationOptions({
			onError: (error) => {
				toastMutationError(error, { title: "Couldn't remove scene" });
			},
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: projectQueryKey(projectId) });
			},
		}),
	);
}
