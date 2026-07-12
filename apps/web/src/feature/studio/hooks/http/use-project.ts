"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectDetail } from "@video-platform-challenge/api";
import { ProjectStatus } from "@video-platform-challenge/types";

import { orpc } from "@/libs/orpc";
import { toastMutationError } from "@/libs/orpc/mutation-error";

/**
 * The minimal shape `isProjectActive` needs — a structural subset of
 * `ProjectDetail` so call sites that only have `{ status }` handy (e.g. the
 * Scenes panel's own `project` selector, not the full polled detail) can
 * reuse the same activity rule instead of re-deriving it.
 */
export type ProjectActivityInput = { status: ProjectDetail["status"] };

// `READY`/`FAILED` are the only two statuses `finalizeProject`
// (apps/server/src/services/generation.service.ts) ever settles into once a
// generation/extend run ends — every other status (`draft`, `planning`,
// `storyboard`, `generating`, `assembling`) is mid-flight. Deliberately a
// TERMINAL allowlist (not an ACTIVE one): a project-level terminal status is
// authoritative over individual scene statuses. Fix-pass (front-wiring phase
// 1 verification): an earlier version also treated "any scene not yet
// video_ready/failed" as active, which kept polling forever for a project
// whose plan step failed BEFORE any scene started generating — those scenes
// stay `planned` permanently (nothing will ever move them without an
// explicit user action, which invalidates the query itself on success), so
// they must not keep the project "active".
const TERMINAL_PROJECT_STATUSES: readonly ProjectStatus[] = [
	ProjectStatus.READY,
	ProjectStatus.FAILED,
];

const POLL_INTERVAL_MS = 2500;

/**
 * True while the project itself hasn't settled to a terminal status yet
 * (docs/studio-ui.md §0 "generating state" — plan/asset phases). Exported so
 * the Studio topbar/dock/Scenes panel can derive the same "is this project
 * busy" signal without re-deriving the status list.
 */
export function isProjectActive(
	detail: ProjectActivityInput | undefined,
): boolean {
	return (
		detail !== undefined && !TERMINAL_PROJECT_STATUSES.includes(detail.status)
	);
}

function projectQueryKey(projectId: string) {
	return orpc.projects.get.queryOptions({ input: { id: projectId } }).queryKey;
}

/**
 * Studio's polling surface (docs/studio-ui.md §0, §4): full project detail
 * (project row + scenes + assets + versions), refetched every 2.5s while
 * generation is in flight anywhere in the project, off once everything has
 * settled to a terminal state (ready/failed).
 */
export function useProject(projectId: string) {
	return useQuery(
		orpc.projects.get.queryOptions({
			input: { id: projectId },
			refetchInterval: (query) =>
				isProjectActive(query.state.data) ? POLL_INTERVAL_MS : false,
		}),
	);
}

/**
 * Timeline reorder/duration persist (docs/studio-ui.md §1 "Timeline" +
 * Studio draft store's reconcile rule) — called from
 * `feature/studio/hooks/use-draft-persistence.ts` on a debounce, never
 * directly from a component. `INVALID_TIMELINE` and `NOT_FOUND` surface as a
 * toast; the caller (the persistence hook) is responsible for rolling the
 * draft store's optimistic timeline back on error.
 */
export function useUpdateDraftTimeline(projectId: string) {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.projects.updateDraftTimeline.mutationOptions({
			onError: (error) => {
				toastMutationError(error, { title: "Couldn't save timeline order" });
			},
			onSuccess: (project) => {
				queryClient.setQueryData(
					projectQueryKey(projectId),
					(current: ProjectDetail | undefined) =>
						current && { ...current, ...project },
				);
			},
		}),
	);
}

export function useUpdateSubtitleStyle(projectId: string) {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.projects.updateSubtitleStyle.mutationOptions({
			onError: (error) => {
				toastMutationError(error, { title: "Couldn't save subtitle style" });
			},
			onSuccess: (project) => {
				queryClient.setQueryData(
					projectQueryKey(projectId),
					(current: ProjectDetail | undefined) =>
						current && { ...current, ...project },
				);
			},
		}),
	);
}

/** Voice/subtitle language selectors — shared by the Home composer (create input) and the Studio dock. */
export function useUpdateLanguages(projectId: string) {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.projects.updateLanguages.mutationOptions({
			onError: (error) => {
				toastMutationError(error, { title: "Couldn't update languages" });
			},
			onSuccess: (project) => {
				queryClient.setQueryData(
					projectQueryKey(projectId),
					(current: ProjectDetail | undefined) =>
						current && { ...current, ...project },
				);
			},
		}),
	);
}

/**
 * "Add scene" (docs/studio-ui.md §1 "Timeline"): server appends one
 * agent-authored scene to the draft timeline and flips the project to
 * `generating`. Returns only the new `Scene`, not the full detail, so on
 * success this just invalidates `projects.get` — the resulting refetch (and
 * the draft store's `applyServerSnapshot` reconcile) picks up the new scene,
 * the extended timeline, and the `generating` status in one shot instead of
 * hand-reconstructing the timeline entry client-side. `CONFLICT` (already
 * generating) gets friendlier copy — the Scenes panel also disables the
 * button preemptively via `isProjectActive`, this is the race-condition
 * fallback.
 */
export function useExtendProject(projectId: string) {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.projects.extend.mutationOptions({
			onError: (error) => {
				toastMutationError(error, {
					codeMessages: {
						CONFLICT:
							"This project is already generating — try again once it settles.",
						RATE_LIMITED:
							"You've hit the hourly generation limit. Try again in a bit.",
					},
					title: "Couldn't add scene",
				});
			},
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: projectQueryKey(projectId) });
			},
		}),
	);
}
