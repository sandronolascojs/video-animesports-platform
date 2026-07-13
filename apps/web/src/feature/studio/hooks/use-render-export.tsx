"use client";

import { ORPCError } from "@orpc/client";
import { useQueryClient } from "@tanstack/react-query";
import type { Version } from "@video-platform-challenge/api";
import { AssetKind, SceneStatus } from "@video-platform-challenge/types";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import {
	EmptyTimelineError,
	ExportCanceledError,
	exportProjectVideo,
	SceneNotReadyError,
	SceneVideoUnreadableError,
} from "@/feature/studio/lib/export";
import { useStudio } from "@/feature/studio/stores/use-studio";
import { orpc, orpcClient } from "@/libs/orpc";
import { toast } from "@/libs/toast";

export type RenderExportState =
	| { status: "idle" }
	| { status: "preparing" }
	| { status: "rendering"; progress: number; versionId: string }
	| { status: "uploading"; progress: number; versionId: string }
	| { status: "done"; version: Version }
	| { status: "error"; message: string };

/**
 * Shared button-label formatter — the topbar Export button and the timeline
 * Render button both call this so their in-flight copy never drifts apart.
 * `idleLabel` lets each call site keep its own resting-state word ("Export"
 * vs "Render") while sharing the exact same in-flight progress copy.
 */
export function renderButtonLabel(
	state: RenderExportState,
	idleLabel = "Render",
): string {
	switch (state.status) {
		case "preparing":
			return "Preparing…";
		case "rendering":
			return `Rendering ${Math.round(state.progress * 100)}%…`;
		case "uploading":
			return `Uploading ${Math.round(state.progress * 100)}%…`;
		case "idle":
		case "done":
		case "error":
			return idleLabel;
	}
}

type RenderExportContextValue = {
	state: RenderExportState;
	/** True while any of preparing/rendering/uploading is in flight — the "disable while running" signal for both trigger points (topbar Export + timeline Render). */
	isRunning: boolean;
	/**
	 * Per-scene readiness gate (SCOPE item 4): true only when every timeline
	 * entry maps to a `video_ready` scene. The project-level `ready` status
	 * isn't used here on purpose — it lags the per-scene truth during
	 * extend/retry flows.
	 */
	canRender: boolean;
	start: () => void;
	cancel: () => void;
};

const RenderExportContext = createContext<RenderExportContextValue | null>(
	null,
);

/** Uploads `blob` to a presigned PUT URL via `XMLHttpRequest` (not `fetch`) specifically to get real `xhr.upload.onprogress` events for the History panel's progress bar — `fetch` has no cross-browser upload-progress signal. Aborts cleanly via `signal`. */
function putWithProgress(
	url: string,
	blob: Blob,
	onProgress: (fraction: number) => void,
	signal: AbortSignal,
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new ExportCanceledError());
			return;
		}

		const xhr = new XMLHttpRequest();
		xhr.open("PUT", url);
		xhr.setRequestHeader(
			"Content-Type",
			blob.type || "application/octet-stream",
		);

		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable) {
				onProgress(event.loaded / event.total);
			}
		};
		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				resolve();
			} else {
				reject(new Error(`Upload failed with status ${xhr.status}.`));
			}
		};
		xhr.onerror = () => reject(new Error("Upload failed (network error)."));
		xhr.onabort = () => reject(new ExportCanceledError());

		const onAbort = () => xhr.abort();
		signal.addEventListener("abort", onAbort);
		xhr.onloadend = () => signal.removeEventListener("abort", onAbort);

		xhr.send(blob);
	});
}

/**
 * Maps a caught error to user-facing toast copy. `CONFLICT` (an existing
 * `rendering` version, still within its 20min abandon window — docs §9) and
 * this lib's own preflight guard errors get specific, useful copy; every
 * other failure (network blip, upload failure, server-side
 * `GENERATION_FAILED`) gets the deliberately clean, generic copy the phase
 * brief asks for rather than a raw technical message — the failed version
 * stays visible in History and reclaims server-side after 20 minutes either
 * way, so there's nothing actionable to add.
 */
function toErrorCopy(error: unknown): { title: string; description: string } {
	if (error instanceof ORPCError && error.code === "CONFLICT") {
		return {
			description: "A render is already in progress for this project.",
			title: "Couldn't start render",
		};
	}
	if (
		error instanceof SceneNotReadyError ||
		error instanceof EmptyTimelineError ||
		error instanceof SceneVideoUnreadableError
	) {
		return { description: error.message, title: "Export failed" };
	}
	return {
		description: "Export failed — you can retry.",
		title: "Export failed",
	};
}

/**
 * Owns the R1 render pipeline's state machine (docs §9 "MVP path (browser)":
 * `versions.render` → client remux → `assets.createUpload` → PUT →
 * `versions.markRendered`) behind a Context, so the topbar Export button and
 * the timeline Render button — SCOPE item 3's "unify: both trigger the same
 * hook" — drive and observe the exact same in-flight run instead of each
 * starting its own. Mounted once per Studio (inside `DraftStoreProvider`,
 * which is where `useStudio()` becomes valid).
 */
export function RenderExportProvider({ children }: { children: ReactNode }) {
	const { orderedScenes, timeline, scenesById, projectId, subtitleStyle } =
		useStudio();
	const queryClient = useQueryClient();
	const [state, setState] = useState<RenderExportState>({ status: "idle" });
	const abortRef = useRef<AbortController | null>(null);
	const runningRef = useRef(false);

	const canRender =
		timeline.length > 0 &&
		orderedScenes.length === timeline.length &&
		orderedScenes.every(
			({ scene }) => scene.status === SceneStatus.VIDEO_READY,
		);

	const isRunning =
		state.status === "preparing" ||
		state.status === "rendering" ||
		state.status === "uploading";

	const start = useCallback(() => {
		if (runningRef.current) {
			return;
		}
		runningRef.current = true;
		const controller = new AbortController();
		abortRef.current = controller;

		const invalidateProject = () =>
			queryClient.invalidateQueries({
				queryKey: orpc.projects.get.queryOptions({ input: { id: projectId } })
					.queryKey,
			});

		void (async () => {
			try {
				setState({ status: "preparing" });
				const version = await orpcClient.versions.render({ projectId });

				setState({ progress: 0, status: "rendering", versionId: version.id });
				// One batch fetch of every signed asset URL for the project, then a
				// sync map lookup per clip — replaces the per-asset download fan-out
				// the export used to fire (one request per timeline entry).
				const projectUrls = await orpcClient.assets.getProjectUrls({
					projectId,
				});
				const assetUrlById = new Map(
					projectUrls.map((entry): [string, string] => [
						entry.assetId,
						entry.url,
					]),
				);
				const blob = await exportProjectVideo({
					getAssetUrl: async (assetId) => {
						const url = assetUrlById.get(assetId);
						if (!url) {
							throw new Error(`No signed URL for asset ${assetId}`);
						}
						return url;
					},
					onProgress: (progress) => {
						setState({
							progress: progress.fraction,
							status: "rendering",
							versionId: version.id,
						});
					},
					scenesById,
					signal: controller.signal,
					subtitleStyle,
					timeline: version.timeline,
				});

				setState({ progress: 0, status: "uploading", versionId: version.id });
				const upload = await orpcClient.assets.createUpload({
					contentType: "video/mp4",
					kind: AssetKind.RENDER,
					projectId,
					size: blob.size,
				});

				await putWithProgress(
					upload.uploadUrl,
					blob,
					(progress) =>
						setState({ progress, status: "uploading", versionId: version.id }),
					controller.signal,
				);

				const rendered = await orpcClient.versions.markRendered({
					id: version.id,
					renderAssetId: upload.assetId,
				});

				invalidateProject();
				setState({ status: "done", version: rendered });
				toast.success({
					description: "Download it from the History panel.",
					title: `Version ${rendered.number} ready`,
				});
			} catch (error) {
				if (error instanceof ExportCanceledError) {
					setState({ status: "idle" });
					return;
				}

				const copy = toErrorCopy(error);
				setState({ message: copy.description, status: "error" });
				invalidateProject();
				toast.error(copy);
			} finally {
				runningRef.current = false;
				abortRef.current = null;
			}
		})();
	}, [projectId, scenesById, subtitleStyle, queryClient]);

	// REN-3: reconciles the server row on cancel — without this, an aborted
	// export left its `rendering` version alive for the full
	// RENDER_ABANDON_MINUTES window, CONFLICTing an immediate retry.
	// Fire-and-forget: the abort itself is what matters to the UI, this is
	// best-effort cleanup (idempotent server-side either way).
	const cancel = useCallback(() => {
		abortRef.current?.abort();
		void orpcClient.versions.cancel({ projectId }).catch(() => {});
	}, [projectId]);

	// Batch C fix 3: `cancel()` above existed but nothing called it on
	// unmount, so navigating away from Studio mid-render left the browser
	// pipeline running AND the server `rendering` version alive for the full
	// RENDER_ABANDON_MINUTES window — CONFLICTing an immediate retry.
	// `runningRef` (not `isRunning` state) so this reads the live value at
	// cleanup time rather than closing over a stale render's snapshot.
	useEffect(() => {
		return () => {
			if (runningRef.current) {
				cancel();
			}
		};
	}, [cancel]);

	const value = useMemo(
		() => ({ canRender, cancel, isRunning, start, state }),
		[canRender, cancel, isRunning, start, state],
	);

	return (
		<RenderExportContext.Provider value={value}>
			{children}
		</RenderExportContext.Provider>
	);
}

/** Consumer hook for both trigger points (`StudioTopbar`'s Export, `TimelineStrip`'s Render) and the History panel's progress display. */
export function useRenderExport(): RenderExportContextValue {
	const context = useContext(RenderExportContext);
	if (!context) {
		throw new Error(
			"useRenderExport must be used within a RenderExportProvider",
		);
	}
	return context;
}
