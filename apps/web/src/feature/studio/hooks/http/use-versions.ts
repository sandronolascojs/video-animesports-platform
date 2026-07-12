"use client";

import { useMutation } from "@tanstack/react-query";
import type { Version } from "@video-platform-challenge/api";
import { useProject } from "@/feature/studio/hooks/http/use-project";
import { orpc } from "@/libs/orpc";
import { toastMutationError } from "@/libs/orpc/mutation-error";

/**
 * History panel's data source (docs/studio-ui.md §1 "History"). `versions`
 * already ships inside `projects.get`'s detail payload (docs §5 "carries
 * everything the Studio needs... without any extra round-trips") — this is a
 * selector over that same polled query, not a second network call.
 */
export function useVersions(projectId: string): Version[] {
	const { data } = useProject(projectId);
	return data?.versions ?? [];
}

/**
 * History panel's "Restore" action (docs/studio-ui.md §9, non-destructive
 * history): the server returns the target version's timeline snapshot only —
 * restoring never mutates the version row itself. The caller applies the
 * returned timeline to the draft store (marks it dirty), which then flows
 * through the SAME debounced `projects.updateDraftTimeline` persist path as
 * a manual reorder — restore is just another way to arrive at a timeline.
 */
export function useRestoreVersion() {
	return useMutation(
		orpc.versions.restore.mutationOptions({
			onError: (error) => {
				toastMutationError(error, { title: "Couldn't restore version" });
			},
		}),
	);
}
