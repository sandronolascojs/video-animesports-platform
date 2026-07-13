"use client";

import type { Version } from "@video-platform-challenge/api";
import { CheckIcon, DownloadIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAssetUrl } from "@/feature/studio/hooks/http/use-project-asset-urls";
import { useRestoreVersion } from "@/feature/studio/hooks/http/use-versions";
import { useRenderExport } from "@/feature/studio/hooks/use-render-export";
import { useStudio } from "@/feature/studio/stores/use-studio";
import { toast } from "@/libs/toast";
import { cn } from "@/libs/utils";

function formatVersionDate(date: Date) {
	return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function timelinesMatch(
	a: { sceneId: string }[],
	b: { sceneId: string }[],
): boolean {
	return (
		a.length === b.length &&
		a.every((entry, index) => entry.sceneId === b[index]?.sceneId)
	);
}

const STATUS_LABEL: Record<Version["status"], string> = {
	failed: "Failed",
	ready: "Ready",
	rendering: "Rendering…",
};

type LiveProgress = {
	versionId: string;
	fraction: number;
	stage: "rendering" | "uploading";
};

/**
 * One version row: thumbnail + restore (docs' non-destructive history —
 * restoring never mutates the version) as the main click target, plus a
 * Download action for `ready` versions (SCOPE item 3 — v1 keeps this
 * intentionally simple: no in-Player loading of a rendered version, just a
 * signed-URL download). Split out of `HistoryPanel` so `useAssetUrl`'s
 * per-row hook call has a stable component instance regardless of how many
 * versions are in the list (rules of hooks — calling it inside `.map()`
 * directly would change hook-call count across renders as the list grows).
 */
function HistoryVersionRow({
	version,
	isActive,
	live,
	restoring,
	onRestore,
}: {
	version: Version;
	isActive: boolean;
	live: LiveProgress | null;
	restoring: boolean;
	onRestore: () => void;
}) {
	const isReady = version.status === "ready";
	const download = useAssetUrl(isReady ? version.renderAssetId : null);

	return (
		<div
			className={cn(
				"flex items-center gap-2 rounded-xl border p-2 transition-colors duration-150 ease-out",
				isActive ? "border-primary ring-2 ring-primary/35" : "border-border/60",
			)}
		>
			<button
				type="button"
				disabled={restoring}
				onClick={onRestore}
				className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-90"
			>
				<span
					aria-hidden
					className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(135deg,var(--chart-1),var(--chart-3))] font-semibold text-xs"
				>
					v{version.number}
				</span>
				<span className="min-w-0 flex-1">
					<span className="flex items-center gap-1.5 font-medium text-sm">
						v{version.number}
						{isActive ? <CheckIcon className="size-3.5 text-primary" /> : null}
					</span>
					<span className="flex items-center gap-1.5 text-muted-foreground text-xs">
						{formatVersionDate(version.createdAt)}
						<Badge
							variant={
								version.status === "failed" ? "destructive" : "secondary"
							}
							className="h-4 px-1.5 text-[10px]"
						>
							{live
								? live.stage === "uploading"
									? "Uploading…"
									: "Rendering with subtitles…"
								: STATUS_LABEL[version.status]}
						</Badge>
					</span>
					{live ? (
						<Progress value={live.fraction * 100} className="mt-1.5 h-1" />
					) : null}
				</span>
			</button>

			{isReady && download.data ? (
				<a
					href={download.data.url}
					download={`video-v${version.number}.mp4`}
					className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 ease-out hover:bg-accent/60 hover:text-foreground"
				>
					<DownloadIcon className="size-3.5" />
					<span className="sr-only">Download v{version.number}</span>
				</a>
			) : null}
		</div>
	);
}

/**
 * History panel (docs/studio-ui.md §1 "History"): version rows, active ring
 * on the version whose ordering matches the current draft timeline. While
 * THIS client is driving a render (`useRenderExport`), the matching
 * `rendering` row shows a live progress bar + stage label instead of the
 * plain "Rendering…" badge — see `HistoryVersionRow`.
 */
export function HistoryPanel() {
	const { versions, timeline, applyRestoredTimeline } = useStudio();
	const restoreVersion = useRestoreVersion();
	const { state } = useRenderExport();
	const orderedVersions = [...versions].sort((a, b) => b.number - a.number);

	const live: LiveProgress | null =
		state.status === "rendering" || state.status === "uploading"
			? {
					fraction: state.progress,
					stage: state.status,
					versionId: state.versionId,
				}
			: null;

	return (
		<div className="surface-panel flex h-full min-h-0 flex-col gap-3 p-3">
			<h2 className="px-1 font-semibold text-sm">History</h2>
			<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
				{orderedVersions.length === 0 ? (
					<p className="px-1 text-muted-foreground text-xs">
						No renders yet — hit Render on the timeline to create v1.
					</p>
				) : null}
				{orderedVersions.map((version) => (
					<HistoryVersionRow
						key={version.id}
						version={version}
						isActive={timelinesMatch(version.timeline, timeline)}
						live={live && live.versionId === version.id ? live : null}
						restoring={restoreVersion.isPending}
						onRestore={() => {
							restoreVersion.mutate(
								{ id: version.id },
								{
									onSuccess: ({ timeline: restoredTimeline }) => {
										applyRestoredTimeline(restoredTimeline);
										toast.success({
											description:
												"The draft timeline now matches this version.",
											icon: <CheckIcon className="size-4" />,
											title: `Restored v${version.number}`,
										});
									},
								},
							);
						}}
					/>
				))}
			</div>
		</div>
	);
}
