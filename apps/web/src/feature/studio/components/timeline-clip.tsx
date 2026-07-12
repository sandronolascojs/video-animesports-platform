"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Scene, TimelineEntry } from "@video-platform-challenge/api";
import { SceneStatus } from "@video-platform-challenge/types";

import { Badge } from "@/components/ui/badge";
import { useAssetUrl } from "@/feature/studio/hooks/http/use-asset-url";
import { gradientForScene } from "@/feature/studio/remotion/composition";
import { cn } from "@/libs/utils";

export type TimelineClipProps = {
	entry: TimelineEntry;
	scene: Scene;
	/** Absolute pixel position, not flex flow — see the component doc below. */
	leftPx: number;
	widthPx: number;
	isSelected: boolean;
	onSelect: (sceneId: string) => void;
};

const GENERATING_STATUSES: ReadonlySet<Scene["status"]> = new Set([
	SceneStatus.PLANNED,
	SceneStatus.KEYFRAME_PENDING,
	SceneStatus.VIDEO_PENDING,
]);

/**
 * Keyframe thumbnail tiled across the clip's width, like a filmstrip band —
 * cheap (one signed URL, CSS `repeat-x`) but reads as a real editor filmstrip
 * instead of a single stretched frame. Falls back to the exact same
 * hash-based gradient `composition.tsx` renders as this scene's Player
 * placeholder, so the fallback is visually consistent across canvas and
 * timeline.
 */
function ClipFilmstrip({ scene }: { scene: Scene }) {
	const { data } = useAssetUrl(scene.startKeyframeAssetId);

	if (!data) {
		const [from, to] = gradientForScene(scene.id);
		return (
			<div
				className="h-9 w-full shrink-0"
				style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
			/>
		);
	}

	return (
		<div
			className="h-9 w-full shrink-0 bg-black/20 bg-repeat-x"
			style={{
				backgroundImage: `url(${data.url})`,
				backgroundSize: "auto 100%",
			}}
			role="img"
			aria-label={scene.title ?? "Scene keyframe"}
		/>
	);
}

/**
 * One clip block on the timeline track (docs' requirement 4), draggable via
 * @dnd-kit/sortable. Positioned with explicit `leftPx`/`widthPx` — not flex
 * flow — so its pixel position matches the ruler/playhead's time-based math
 * exactly (a flex `gap` between clips would otherwise accumulate a per-clip
 * offset that drifts the track out of alignment with the ruler). Reordering
 * still works: dnd-kit's sortable strategy measures actual DOM rects, which
 * works identically under absolute positioning.
 */
export function TimelineClip({
	entry,
	scene,
	leftPx,
	widthPx,
	isSelected,
	onSelect,
}: TimelineClipProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: entry.sceneId });

	const isGenerating = GENERATING_STATUSES.has(scene.status);
	const isFailed = scene.status === SceneStatus.FAILED;

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: click-to-select mirrors dnd-kit's own pointer-only drag handle on this element — full keyboard drag-and-select for the timeline is out of v1 scope (dnd-kit's KeyboardSensor still reorders via Tab+Space+arrows on `attributes`/`listeners`).
		<div
			ref={setNodeRef}
			style={{
				left: leftPx,
				top: 0,
				transform: CSS.Transform.toString(transform),
				transition,
				width: widthPx,
			}}
			{...attributes}
			{...listeners}
			onClick={() => onSelect(entry.sceneId)}
			className={cn(
				"absolute flex h-20 cursor-grab touch-none flex-col justify-between overflow-hidden rounded-lg border border-border/60 bg-card active:cursor-grabbing",
				isDragging && "z-30 opacity-50",
				isFailed && "border-destructive/60",
				isSelected && "ring-2 ring-primary",
			)}
		>
			{isGenerating && !isSelected ? (
				<div className="pointer-events-none absolute inset-0 animate-pulse rounded-lg ring-1 ring-primary/50" />
			) : null}
			<ClipFilmstrip scene={scene} />
			<div className="flex min-w-0 items-center justify-between gap-1 px-2 py-1.5">
				<span className="min-w-0 flex-1 truncate text-xs">
					{scene.title ?? "Untitled scene"}
				</span>
				<Badge
					variant="secondary"
					className="h-4 shrink-0 px-1.5 font-mono text-[10px]"
				>
					{entry.durationSeconds.toFixed(1)}s
				</Badge>
			</div>
		</div>
	);
}
