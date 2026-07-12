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
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { MainButton } from "@/components/kit/main-button";
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
	FALLBACK_PX_PER_SECOND,
	fitPxPerSecond,
	formatTimecode,
	framesToSeconds,
	isZoomWheelEvent,
	MAX_PX_PER_SECOND,
	MIN_PX_PER_SECOND,
	MIN_RULER_SECONDS,
	RULER_INSET_PX,
	rulerTicksFor,
	scrollLeftForZoomAtPointer,
	secondsToFrames,
	zoomByFactor,
	zoomInStep,
	zoomOutStep,
} from "@/feature/studio/lib/time";
import { useStudio } from "@/feature/studio/stores/use-studio";

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
	const {
		frame,
		isPlaying,
		seekTo,
		play,
		pause,
		togglePlayback,
		isPlayingNow,
	} = usePlayerPlayback();

	const [pxPerSecond, setPxPerSecond] = useState(FALLBACK_PX_PER_SECOND);
	// Measured width of the scroll container's content box — feeds
	// `fitPxPerSecond` below (Problem 1: fit-to-width base zoom). Starts at 0
	// (unmeasured); the layout effect further down corrects this — and
	// re-clamps `pxPerSecond` — before the first paint.
	const [measuredWidthPx, setMeasuredWidthPx] = useState(0);
	const scrollRef = useRef<HTMLDivElement>(null);
	// State (not a ref): only flips twice per scrub gesture (down/up), so the
	// re-render cost is negligible, and the playhead handle needs it as a
	// render input to spring while any scrub is in flight (docs §3c).
	const [isScrubbing, setIsScrubbing] = useState(false);
	const resumeAfterScrubRef = useRef(false);
	// Captured at wheel-zoom time, consumed by the layout effect below once
	// the DOM reflects the new `trackWidthPx` — see the native wheel listener
	// effect further down.
	const pendingZoomRef = useRef<{
		pointerXPx: number;
		previousScrollLeft: number;
		previousPxPerSecond: number;
	} | null>(null);

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
	// The timeline's own content length (clips), floored so a near-empty
	// project still shows a usable stretch of track. This drives the initial
	// fit-to-width zoom (below) — the default view fills the width with exactly
	// the content.
	const contentSeconds = Math.max(totalSeconds, MIN_RULER_SECONDS);
	// Premiere-style full-width ruler: the ruler/track ALWAYS span the full
	// container width. `visibleSeconds` is how much time the viewport shows at
	// the current zoom; the ruler draws at least that many seconds, so when the
	// user zooms OUT past the content it keeps laying ticks + numbers across the
	// empty track after the last clip ("extends to the end of the zoom")
	// instead of collapsing the timeline into the left with dead space on the
	// right. Zoomed IN, `contentSeconds` wins and the track scrolls.
	const usableWidthPx = Math.max(measuredWidthPx - RULER_INSET_PX * 2, 0);
	const visibleSeconds =
		pxPerSecond > 0 ? usableWidthPx / pxPerSecond : contentSeconds;
	const rulerSeconds = Math.max(contentSeconds, visibleSeconds);
	const trackWidthPx = rulerSeconds * pxPerSecond;
	const hasScenes = timeline.length > 0;

	// Problem 1 (fit-to-width): measure the scroll container so the timeline
	// always spans its full available width instead of a fixed default scale
	// leaving dead space on the right. Re-attaches whenever the container
	// mounts/unmounts (`hasScenes` toggling the empty state below) so a
	// timeline that starts empty still gets measured once scenes appear.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `hasScenes` isn't read in the effect body, but it's the signal that `scrollRef.current` just got mounted/unmounted (a plain ref read doesn't itself trigger a re-run) — dropping it would leave a newly-mounted container unmeasured until some unrelated re-render happened to fire first.
	useLayoutEffect(() => {
		const container = scrollRef.current;
		if (!container) {
			return;
		}
		const measure = () => setMeasuredWidthPx(container.clientWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(container);
		return () => observer.disconnect();
	}, [hasScenes]);

	const fit = useMemo(
		() => fitPxPerSecond(measuredWidthPx, contentSeconds),
		[measuredWidthPx, contentSeconds],
	);

	// Default zoom = fit-to-width, applied ONCE on the first real measurement
	// (Premiere-style: fit is the initial view, not a floor — see time.ts). A
	// layout effect (not a plain effect) so the swap from the arbitrary
	// `FALLBACK_PX_PER_SECOND` seed to the real fit scale lands in the SAME
	// pre-paint flush as the measurement above, with no visible jump. Guarded
	// by a ref so later re-measures (resize, scene add) keep the user's own
	// zoom instead of yanking it back to fit.
	const didInitZoomRef = useRef(false);
	useLayoutEffect(() => {
		if (measuredWidthPx > 0 && !didInitZoomRef.current) {
			didInitZoomRef.current = true;
			setPxPerSecond(fit);
		}
	}, [fit, measuredWidthPx]);

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

	// Faint vertical grid lines down the track at the same major-tick cadence
	// as the ruler — the "editor lines" that make the track read as an NLE lane
	// (aligned to the ruler numbers above) instead of clips floating in a void.
	const gridlines = useMemo(() => {
		const { majorStepSeconds } = rulerTicksFor(pxPerSecond);
		const count = Math.floor(rulerSeconds / majorStepSeconds);
		const lines: Array<{ seconds: number; leftPx: number }> = [];
		for (let index = 0; index <= count; index++) {
			const seconds = index * majorStepSeconds;
			lines.push({ leftPx: seconds * pxPerSecond, seconds });
		}
		return lines;
	}, [pxPerSecond, rulerSeconds]);

	const seekToClientX = useCallback(
		(clientX: number) => {
			const container = scrollRef.current;
			if (!container || totalSeconds <= 0) {
				return;
			}
			const rect = container.getBoundingClientRect();
			// `- RULER_INSET_PX`: the track's second-0 mark sits `RULER_INSET_PX`
			// in from the scroll container's own left edge (see the inset
			// wrapper in the render below), so pointer math has to shift by the
			// same amount to land on the right instant.
			const rawSeconds =
				(clientX - rect.left - RULER_INSET_PX + container.scrollLeft) /
				pxPerSecond;
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
			setIsScrubbing(true);
			seekToClientX(event.clientX);
		},
		[isPlayingNow, pause, seekToClientX],
	);

	const handleScrubPointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!isScrubbing) {
				return;
			}
			seekToClientX(event.clientX);
		},
		[isScrubbing, seekToClientX],
	);

	const handleScrubPointerEnd = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!isScrubbing) {
				return;
			}
			setIsScrubbing(false);
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
			if (resumeAfterScrubRef.current) {
				resumeAfterScrubRef.current = false;
				play();
			}
		},
		[isScrubbing, play],
	);

	// Cursor-anchored zoom: the layout effect below runs after `pxPerSecond`
	// has already re-rendered `trackWidthPx` into the DOM (but before paint),
	// so it can set `scrollLeft` from the NEW width without a visible flash.
	useLayoutEffect(() => {
		const pending = pendingZoomRef.current;
		const container = scrollRef.current;
		if (!pending || !container) {
			return;
		}
		pendingZoomRef.current = null;
		container.scrollLeft = scrollLeftForZoomAtPointer(
			pending.previousScrollLeft,
			pending.pointerXPx,
			pending.previousPxPerSecond,
			pxPerSecond,
		);
	}, [pxPerSecond]);

	// Problem 3 (critical): pinch-zooming the timeline must never ALSO zoom
	// the browser page. React's `onWheel` is a PASSIVE listener by default, so
	// `event.preventDefault()` inside a JSX `onWheel` handler is silently
	// ignored — the browser's native pinch-zoom (which also fires as
	// `ctrlKey` + wheel) still runs. The only fix is a real, non-passive
	// listener attached imperatively, so both the zoom AND pan branches live
	// here instead of in a JSX `onWheel` prop. Re-attaches on `hasScenes`
	// (container mount/unmount).
	// biome-ignore lint/correctness/useExhaustiveDependencies: `hasScenes` isn't read in the effect body, but (like the measurement effect above) it's the signal that `scrollRef.current` just got mounted/unmounted.
	useEffect(() => {
		const container = scrollRef.current;
		if (!container) {
			return;
		}

		const handleWheelNative = (event: WheelEvent) => {
			// Pinch-zoom (every OS) and the explicit Cmd/Ctrl+wheel shortcut.
			if (isZoomWheelEvent(event)) {
				event.preventDefault();
				event.stopPropagation();
				const pointerXPx =
					event.clientX - container.getBoundingClientRect().left;
				const factor = event.deltaY > 0 ? 1 / 1.08 : 1.08;
				setPxPerSecond((current) => {
					pendingZoomRef.current = {
						pointerXPx,
						previousPxPerSecond: current,
						previousScrollLeft: container.scrollLeft,
					};
					return zoomByFactor(current, factor);
				});
				return;
			}

			// Plain wheel / two-finger scroll pans horizontally — a vertical
			// mouse-wheel delta is the common case (most mice only report
			// deltaY), a genuine horizontal trackpad swipe reports deltaX
			// directly, so prefer whichever axis actually moved.
			const panDeltaPx = event.deltaX || event.deltaY;
			if (panDeltaPx !== 0) {
				event.preventDefault();
				container.scrollLeft += panDeltaPx;
			}
		};

		container.addEventListener("wheel", handleWheelNative, {
			passive: false,
		});
		return () => container.removeEventListener("wheel", handleWheelNative);
	}, [hasScenes]);

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
					{/* Premiere-style zoom over the absolute [MIN, MAX] px/s range —
					    "−" pulls away from the timeline (below the fit scale, dead
					    space on the right) until MIN, "+" zooms in to inspect until
					    MAX (see time.ts). */}
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className="text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
						disabled={pxPerSecond <= MIN_PX_PER_SECOND}
						onClick={() => setPxPerSecond((current) => zoomOutStep(current))}
					>
						<MinusIcon className="size-3" />
						<span className="sr-only">Zoom out</span>
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className="text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
						disabled={pxPerSecond >= MAX_PX_PER_SECOND}
						onClick={() => setPxPerSecond((current) => zoomInStep(current))}
					>
						<PlusIcon className="size-3" />
						<span className="sr-only">Zoom in</span>
					</Button>
				</ButtonGroup>

				<Tooltip>
					<TooltipTrigger asChild>
						<span>
							<MainButton
								type="button"
								size="sm"
								disabled={isRunning || timeline.length === 0 || !canRender}
								onClick={start}
							>
								{renderButtonLabel(state)}
							</MainButton>
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

			{!hasScenes ? (
				<div className="flex min-h-0 flex-1 items-center justify-center gap-2 rounded-xl border border-border/60 border-dashed text-muted-foreground text-sm">
					<ClapperboardIcon className="size-4" />
					No scenes yet — the timeline appears here once you add one.
				</div>
			) : (
				<div
					ref={scrollRef}
					className="scrollbar-thin relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden"
				>
					{/* Outer content box reserves `RULER_INSET_PX` of scrollable
					    space on BOTH edges — at fit zoom this makes the scrollable
					    content exactly match the container's width (no leftover
					    scroll room), while giving the 0:00 / end labels breathing
					    room instead of sitting flush against the container edge. */}
					<div style={{ width: trackWidthPx + RULER_INSET_PX * 2 }}>
						<div
							className="relative"
							style={{ marginLeft: RULER_INSET_PX, width: trackWidthPx }}
						>
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
									{/* Editor track lane: a full-width band with a subtle fill
									    and inset hairline so clips sit INSIDE a visible track
									    (and the empty track past the last clip still reads as a
									    lane when zoomed out) instead of floating on black. */}
									<div
										className="relative mt-1 overflow-hidden rounded-lg bg-white/[0.02] ring-1 ring-border/40 ring-inset"
										style={{ height: TRACK_HEIGHT_PX, width: trackWidthPx }}
									>
										{/* Vertical grid lines aligned to the ruler's major ticks. */}
										<div
											aria-hidden
											className="pointer-events-none absolute inset-0"
										>
											{gridlines.map((line) => (
												<div
													key={line.seconds}
													className="absolute inset-y-0 w-px bg-border/25"
													style={{ left: line.leftPx }}
												/>
											))}
										</div>
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
								isScrubbing={isScrubbing}
								onScrubPointerDown={handleScrubPointerDown}
								onScrubPointerMove={handleScrubPointerMove}
								onScrubPointerEnd={handleScrubPointerEnd}
							/>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
