"use client";

import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	horizontalListSortingStrategy,
	SortableContext,
	sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import {
	ClapperboardIcon,
	MinusIcon,
	PauseIcon,
	PlayIcon,
	PlusIcon,
	XIcon,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { TimelineClip } from "@/feature/studio/components/timeline-clip";
import { TimelinePlayhead } from "@/feature/studio/components/timeline-playhead";
import { TimelineRuler } from "@/feature/studio/components/timeline-ruler";
import { usePlayerPlayback } from "@/feature/studio/hooks/use-player-playback";
import {
	renderButtonLabel,
	useRenderExport,
} from "@/feature/studio/hooks/use-render-export";
import {
	clampSeconds,
	DEFAULT_PX_PER_SECOND,
	formatTimecode,
	framesToSeconds,
	MAX_PX_PER_SECOND,
	MIN_PX_PER_SECOND,
	MIN_RULER_SECONDS,
	secondsToFrames,
	zoomByFactor,
	zoomInStep,
	zoomOutStep,
} from "@/feature/studio/lib/time";
import { useStudio } from "@/feature/studio/stores/use-studio";
import { usePlatform } from "@/hooks/use-platform";

/** Rendered clip width shrinks by this many px so a hairline gap shows between adjacent clips — purely cosmetic, `leftPx` (time-based) is untouched so ruler/playhead alignment never drifts (see timeline-clip.tsx doc comment). */
const CLIP_GAP_PX = 2;
/** Track band height — clips render at `h-20` (80px); keep these in sync. */
const TRACK_HEIGHT_PX = 80;
/** Pointer must move this many px from a scrub's start before snapping to a clip boundary "steals" the seek target. */
const SNAP_THRESHOLD_PX = 6;

type ClipLayout = {
	sceneId: string;
	leftPx: number;
	widthPx: number;
};

/**
 * Timeline strip (docs/studio-ui.md §1 "Timeline", spans the FULL bottom
 * width): time ruler + playhead synced with the Remotion Player + @dnd-kit
 * horizontal sortable clip blocks. Render button drives the shared
 * `useRenderExport` state machine (docs §9's browser render flow) —
 * `versions.render` → client-side Mediabunny remux → upload → `markRendered`
 * — the SAME pipeline the topbar's Export button triggers (front-wiring
 * phase 3); disabled while running or until every scene is `video_ready`.
 *
 * Time math: `feature/studio/lib/time.ts` (fps single-sourced with
 * `remotion/composition.tsx`). Playhead sync: `use-player-playback.ts`
 * subscribes to the shared `PlayerRef` (`player-ref-context.tsx`) for
 * `frameupdate`/`play`/`pause` events — the Player is the single source of
 * truth, this component never tracks its own play state.
 */
export function TimelineStrip() {
	const {
		orderedScenes,
		timeline,
		reorderTimeline,
		selectedSceneId,
		selectScene,
	} = useStudio();
	const { canRender, cancel, isRunning, start, state } = useRenderExport();
	const { isMac } = usePlatform();
	const {
		frame,
		isPlaying,
		seekTo,
		play,
		pause,
		togglePlayback,
		isPlayingNow,
	} = usePlayerPlayback();

	const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SECOND);
	const scrollRef = useRef<HTMLDivElement>(null);
	const scrubbingRef = useRef(false);
	const resumeAfterScrubRef = useRef(false);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const totalSeconds = timeline.reduce(
		(total, entry) => total + entry.durationSeconds,
		0,
	);
	const rulerSeconds = Math.max(totalSeconds, MIN_RULER_SECONDS);
	const trackWidthPx = rulerSeconds * pxPerSecond;

	const { clips, boundarySeconds } = useMemo(() => {
		let cursor = 0;
		const nextClips: ClipLayout[] = [];
		const nextBoundaries = [0];
		for (const { entry } of orderedScenes) {
			nextClips.push({
				leftPx: cursor * pxPerSecond,
				sceneId: entry.sceneId,
				widthPx: Math.max(entry.durationSeconds * pxPerSecond - CLIP_GAP_PX, 1),
			});
			cursor += entry.durationSeconds;
			nextBoundaries.push(cursor);
		}
		return { boundarySeconds: nextBoundaries, clips: nextClips };
	}, [orderedScenes, pxPerSecond]);

	const seekToClientX = useCallback(
		(clientX: number) => {
			const container = scrollRef.current;
			if (!container || totalSeconds <= 0) {
				return;
			}
			const rect = container.getBoundingClientRect();
			const rawSeconds =
				(clientX - rect.left + container.scrollLeft) / pxPerSecond;
			let seconds = clampSeconds(rawSeconds, totalSeconds);

			const snapThresholdSeconds = SNAP_THRESHOLD_PX / pxPerSecond;
			for (const boundary of boundarySeconds) {
				if (Math.abs(seconds - boundary) <= snapThresholdSeconds) {
					seconds = boundary;
					break;
				}
			}
			seekTo(secondsToFrames(seconds));
		},
		[pxPerSecond, totalSeconds, boundarySeconds, seekTo],
	);

	const handleScrubPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (event.button !== 0 && event.pointerType === "mouse") {
				return;
			}
			try {
				event.currentTarget.setPointerCapture(event.pointerId);
			} catch {
				// Per spec, `setPointerCapture` throws `NotFoundError` if the
				// pointer isn't currently "active" (e.g. already released by the
				// time this handler runs) — losing capture only means a drag that
				// leaves the element bounds stops tracking, not a broken scrub, so
				// this is safe to swallow rather than let it crash the handler.
			}
			resumeAfterScrubRef.current = isPlayingNow();
			if (resumeAfterScrubRef.current) {
				pause();
			}
			scrubbingRef.current = true;
			seekToClientX(event.clientX);
		},
		[isPlayingNow, pause, seekToClientX],
	);

	const handleScrubPointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!scrubbingRef.current) {
				return;
			}
			seekToClientX(event.clientX);
		},
		[seekToClientX],
	);

	const handleScrubPointerEnd = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!scrubbingRef.current) {
				return;
			}
			scrubbingRef.current = false;
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
			if (resumeAfterScrubRef.current) {
				resumeAfterScrubRef.current = false;
				play();
			}
		},
		[play],
	);

	const handleWheel = useCallback(
		(event: React.WheelEvent<HTMLDivElement>) => {
			const isZoomGesture = isMac ? event.metaKey : event.ctrlKey;
			if (!isZoomGesture) {
				return;
			}
			event.preventDefault();
			setPxPerSecond((current) =>
				zoomByFactor(current, event.deltaY > 0 ? 1 / 1.08 : 1.08),
			);
		},
		[isMac],
	);

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) {
			return;
		}
		const oldIndex = timeline.findIndex((entry) => entry.sceneId === active.id);
		const newIndex = timeline.findIndex((entry) => entry.sceneId === over.id);
		if (oldIndex === -1 || newIndex === -1) {
			return;
		}
		reorderTimeline(arrayMove(timeline, oldIndex, newIndex));
	};

	const playheadLeftPx = clampSeconds(
		framesToSeconds(frame) * pxPerSecond,
		trackWidthPx,
	);

	return (
		<div className="surface-panel flex h-full flex-col gap-2 p-3">
			<div className="flex shrink-0 items-center gap-2">
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					disabled={timeline.length === 0}
					onClick={togglePlayback}
				>
					{isPlaying ? (
						<PauseIcon className="size-4" />
					) : (
						<PlayIcon className="size-4" />
					)}
					<span className="sr-only">{isPlaying ? "Pause" : "Play"}</span>
				</Button>

				<span className="font-mono text-muted-foreground text-xs tabular-nums">
					{formatTimecode(framesToSeconds(frame))} /{" "}
					{formatTimecode(totalSeconds)}
				</span>

				<div className="flex-1" />

				<ButtonGroup>
					<Button
						type="button"
						variant="outline"
						size="icon-xs"
						disabled={pxPerSecond <= MIN_PX_PER_SECOND}
						onClick={() => setPxPerSecond(zoomOutStep)}
					>
						<MinusIcon className="size-3" />
						<span className="sr-only">Zoom out</span>
					</Button>
					<Button
						type="button"
						variant="outline"
						size="icon-xs"
						disabled={pxPerSecond >= MAX_PX_PER_SECOND}
						onClick={() => setPxPerSecond(zoomInStep)}
					>
						<PlusIcon className="size-3" />
						<span className="sr-only">Zoom in</span>
					</Button>
				</ButtonGroup>

				<Tooltip>
					<TooltipTrigger asChild>
						<span>
							<Button
								type="button"
								size="sm"
								disabled={isRunning || timeline.length === 0 || !canRender}
								onClick={start}
							>
								{renderButtonLabel(state)}
							</Button>
						</span>
					</TooltipTrigger>
					{!canRender && timeline.length > 0 ? (
						<TooltipContent>All scenes must finish generating</TooltipContent>
					) : null}
				</Tooltip>

				{isRunning ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label="Cancel render"
								onClick={cancel}
							>
								<XIcon className="size-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Cancel render</TooltipContent>
					</Tooltip>
				) : null}
			</div>

			{timeline.length === 0 ? (
				<div className="flex min-h-0 flex-1 items-center justify-center gap-2 rounded-xl border border-border/60 border-dashed text-muted-foreground text-sm">
					<ClapperboardIcon className="size-4" />
					No scenes yet — the timeline appears here once you add one.
				</div>
			) : (
				<div
					ref={scrollRef}
					className="scrollbar-thin relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden"
					onWheel={handleWheel}
				>
					<div className="relative" style={{ width: trackWidthPx }}>
						<TimelineRuler
							pxPerSecond={pxPerSecond}
							rulerSeconds={rulerSeconds}
							widthPx={trackWidthPx}
							onScrubPointerDown={handleScrubPointerDown}
							onScrubPointerMove={handleScrubPointerMove}
							onScrubPointerEnd={handleScrubPointerEnd}
						/>

						<DndContext
							// Explicit `id` (not dnd-kit's auto-generated one): the
							// auto-generated id is a module-level counter that can
							// legitimately differ between the SSR pass and the client's
							// first hydration render (e.g. React 19 dev double-render),
							// producing an `aria-describedby` mismatch — a documented
							// dnd-kit SSR gotcha, fixed by pinning a stable id.
							id="studio-timeline-dnd"
							sensors={sensors}
							collisionDetection={closestCenter}
							onDragEnd={handleDragEnd}
						>
							<SortableContext
								items={timeline.map((entry) => entry.sceneId)}
								strategy={horizontalListSortingStrategy}
							>
								<div
									className="relative mt-1"
									style={{ height: TRACK_HEIGHT_PX, width: trackWidthPx }}
								>
									{/* Background scrub target — sits behind the clips (DOM order), so pointer events land on whichever is topmost at that x/y with no propagation tricks needed. */}
									<div
										className="absolute inset-0 touch-none"
										onPointerDown={handleScrubPointerDown}
										onPointerMove={handleScrubPointerMove}
										onPointerUp={handleScrubPointerEnd}
										onPointerCancel={handleScrubPointerEnd}
									/>
									{orderedScenes.map(({ entry, scene }, index) => {
										const layout = clips[index];
										if (!layout) {
											return null;
										}
										return (
											<TimelineClip
												key={entry.sceneId}
												entry={entry}
												scene={scene}
												leftPx={layout.leftPx}
												widthPx={layout.widthPx}
												isSelected={selectedSceneId === entry.sceneId}
												onSelect={selectScene}
											/>
										);
									})}
								</div>
							</SortableContext>
						</DndContext>

						<TimelinePlayhead
							leftPx={playheadLeftPx}
							onScrubPointerDown={handleScrubPointerDown}
							onScrubPointerMove={handleScrubPointerMove}
							onScrubPointerEnd={handleScrubPointerEnd}
						/>
					</div>
				</div>
			)}
		</div>
	);
}
