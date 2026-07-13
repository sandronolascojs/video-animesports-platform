"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Scene, TimelineEntry } from "@video-platform-challenge/api";
import { SceneStatus } from "@video-platform-challenge/types";

import { useAssetUrl } from "@/feature/studio/hooks/http/use-project-asset-urls";
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
 * Keyframe thumbnail tiled across the clip's full bleed, filmstrip-style
 * (`repeat-x` at the frame's own aspect, not a single stretched frame) —
 * cheap (one signed URL, CSS tiling) but reads as a real editor filmstrip.
 * No keyframe yet (still planned/generating) falls back to a single subtle
 * `bg-muted` surface (docs/studio-design-language.md §3c: a calm monochrome
 * placeholder here, NOT the saturated per-scene gradient the Player canvas
 * uses as ITS OWN placeholder — the two surfaces are allowed to diverge on
 * this one point, since a wall of rainbow blocks is exactly the "basic" look
 * this redesign removes from the timeline).
 */
function ClipFilmstrip({ scene }: { scene: Scene }) {
	const { data } = useAssetUrl(scene.startKeyframeAssetId);

	if (!data) {
		return <div className="absolute inset-0 bg-muted" />;
	}

	return (
		<div
			className="absolute inset-0 bg-black/20 bg-repeat-x"
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
 *
 * The filmstrip fills the whole clip (`absolute inset-0`); title + duration
 * float over the bottom edge on a legibility scrim so they stay readable
 * over any thumbnail brightness, instead of squeezing the filmstrip band
 * into a shorter fixed-height strip above a separate label row.
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
				"absolute h-20 cursor-grab touch-none overflow-hidden rounded-lg border border-border/60 bg-muted active:cursor-grabbing",
				isDragging && "z-30 opacity-50",
				isFailed && "border-destructive/60",
				isSelected && "ring-1 ring-ring",
			)}
		>
			<ClipFilmstrip scene={scene} />

			{isGenerating ? (
				<div className="pointer-events-none absolute inset-0 bg-foreground/5 motion-safe:animate-pulse" />
			) : null}

			{/* Legibility scrim — keeps the label row readable over any thumbnail. */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-black/60 to-transparent"
			/>

			<div className="absolute inset-x-0 bottom-0 flex min-w-0 items-center justify-between gap-1 px-2 py-1.5">
				<span className="min-w-0 flex-1 truncate text-foreground text-xs">
					{scene.title ?? "Untitled scene"}
				</span>
				<span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
					{entry.durationSeconds.toFixed(1)}s
				</span>
			</div>
		</div>
	);
}
