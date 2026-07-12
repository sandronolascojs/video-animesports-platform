"use client";

import { ProjectStatus } from "@video-platform-challenge/types";
import { PartyPopperIcon } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { isFirstGeneration } from "@/feature/studio/lib/first-run";
import { useStudio } from "@/feature/studio/stores/use-studio";
import { toast } from "@/libs/toast";

/**
 * Fires a one-time celebration toast when a project's FIRST generation
 * completes — the "leave and come back" signal now that the flow is
 * non-blocking (RT-2, docs realtime-and-render-lock-v1.md §2). Because status
 * is SSE-driven (RT-3), the toast fires the moment the pushed event flips the
 * project to `ready`.
 *
 * Two refs gate it to exactly once per first-generation completion:
 *
 * - `armedRef` seeds the moment we observe an in-flight first generation
 *   (`isFirstGeneration` — project active, zero `video_ready` scenes). It
 *   stays armed across a first-run failure + Retry (which never passes
 *   through `ready`), so a retried first generation still celebrates.
 * - `firedRef` makes the toast fire at most once even as the effect re-runs.
 *
 * Extend/retry-of-a-finished-project never arms it: those start from an
 * already-`ready` project (≥1 `video_ready` scene), so `isFirstGeneration` is
 * `false` throughout and reaching `ready` again fires nothing. Revisiting a
 * finished project is likewise silent — it was never armed.
 */
export function useFirstRunToast(): void {
	const { project, scenesById } = useStudio();
	const scenes = useMemo(() => Object.values(scenesById), [scenesById]);
	const armedRef = useRef(false);
	const firedRef = useRef(false);

	useEffect(() => {
		if (isFirstGeneration(project, scenes)) {
			armedRef.current = true;
			return;
		}

		if (
			armedRef.current &&
			!firedRef.current &&
			project.status === ProjectStatus.READY
		) {
			firedRef.current = true;
			toast.success({
				description: "Every scene finished generating — press play.",
				icon: <PartyPopperIcon className="size-4" />,
				title: "Your episode is ready",
			});
		}
	}, [project, scenes]);
}
