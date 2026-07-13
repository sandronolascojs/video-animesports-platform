"use client";

import type {
	Scene,
	SubtitleStyle,
	TimelineEntry,
} from "@video-platform-challenge/api";
import { SceneStatus } from "@video-platform-challenge/types";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import {
	AbsoluteFill,
	OffthreadVideo,
	Sequence,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";

import { useAssetUrl } from "@/feature/studio/hooks/http/use-project-asset-urls";
import {
	STUDIO_BACKDROP_COLOR,
	textShadowIntensityToPixels,
} from "@/feature/studio/lib/subtitle-canvas";
import {
	activeCueAt,
	resolveSubtitleCues,
} from "@/feature/studio/lib/subtitle-cues";
import { STUDIO_FPS } from "@/feature/studio/lib/time";

/**
 * All timing math lives in Remotion frames (docs/studio-ui.md "Implementation
 * rules"). Re-exported so every existing `composition.tsx` import keeps
 * working — `feature/studio/lib/time.ts` is the single source now, shared
 * with the timeline ruler/playhead so the Player and the timeline can never
 * drift apart.
 */
export { STUDIO_FPS };

export type StudioCompositionProps = {
	timeline: TimelineEntry[];
	scenesById: Record<string, Scene>;
	subtitleStyle: SubtitleStyle;
};

export function timelineDurationInFrames(
	timeline: TimelineEntry[],
	fps: number = STUDIO_FPS,
): number {
	const totalSeconds = timeline.reduce(
		(total, entry) => total + entry.durationSeconds,
		0,
	);
	return Math.max(1, Math.round(totalSeconds * fps));
}

type ActiveTimelineEntry = {
	entry: TimelineEntry;
	/** The frame at which this entry's `<Sequence>` starts — i.e. its timeline cursor position. Subtracting this from the composition's own `frame` gives "frames into the active scene", which `StudioComposition` converts to seconds for per-time subtitle cues (see `subtitle-cues.ts`). */
	startFrame: number;
};

/** Single source of truth for "which timeline entry is on screen at `frame`, and where does it start" — `findActiveScene` (below) and `StudioComposition`'s subtitle-cue lookup both delegate to this so the cursor math can never drift between the two. */
function findActiveTimelineEntry(
	timeline: TimelineEntry[],
	frame: number,
	fps: number,
): ActiveTimelineEntry | null {
	let cursor = 0;
	for (const entry of timeline) {
		const durationInFrames = Math.max(
			1,
			Math.round(entry.durationSeconds * fps),
		);
		if (frame < cursor + durationInFrames) {
			return { entry, startFrame: cursor };
		}
		cursor += durationInFrames;
	}
	return null;
}

/** Exported for `composition.test.ts` — pure, zero-DOM, so it's covered directly without mounting the Player. */
export function findActiveScene(
	timeline: TimelineEntry[],
	scenesById: Record<string, Scene>,
	frame: number,
	fps: number,
): Scene | null {
	const active = findActiveTimelineEntry(timeline, frame, fps);
	return active ? (scenesById[active.entry.sceneId] ?? null) : null;
}

// No visual asset carries a "brand color" server-side — this is a stable,
// deterministic placeholder palette (cycles the same 5 chart tokens used
// elsewhere in the app) keyed by scene id, so a given scene's placeholder
// color never flickers between polls/re-renders.
const GRADIENT_PAIRS: readonly [string, string][] = [
	["var(--chart-1)", "var(--chart-2)"],
	["var(--chart-2)", "var(--chart-3)"],
	["var(--chart-3)", "var(--chart-4)"],
	["var(--chart-4)", "var(--chart-5)"],
	["var(--chart-5)", "var(--chart-1)"],
];

/** Exported so `timeline-clip.tsx` can render the exact same gradient as this scene's Player placeholder frame — cohesive fallback across canvas and timeline. */
export function gradientForScene(sceneId: string): [string, string] {
	let hash = 0;
	for (let index = 0; index < sceneId.length; index++) {
		hash = (hash * 31 + sceneId.charCodeAt(index)) >>> 0;
	}
	return GRADIENT_PAIRS[hash % GRADIENT_PAIRS.length] ?? GRADIENT_PAIRS[0];
}

/**
 * Data-driven Studio composition (docs/studio-ui.md §1 "Center"): one
 * `<Sequence>` per draft-timeline entry. A scene with a ready video asset
 * plays it via `OffthreadVideo` (signed URL from `assets.getProjectUrls`);
 * every other status renders the gradient + title placeholder, plus a
 * subtitle overlay live-styled from `subtitleStyle` so the Subtitles tab
 * previews in real time on the Player.
 *
 * Player fidelity (docs/studio-quality-pass.md §4): the render just
 * concatenates clips with hard cuts, so the preview must match exactly — no
 * per-scene fade (see `SceneLayer`). To avoid a load gap when playback/
 * scrubbing crosses into a scene whose `<Sequence>` hasn't mounted yet, every
 * scene's signed video URL is prefetched up front via `ScenePreload` below,
 * unconditionally of the current playhead — `SceneLayer`'s own `useAssetUrl`
 * call for the same asset id then resolves from the TanStack Query cache
 * instead of waiting on a network round trip.
 */
export function StudioComposition({
	timeline,
	scenesById,
	subtitleStyle,
}: StudioCompositionProps) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	let cursor = 0;
	const sequences = timeline.map((entry) => {
		const scene = scenesById[entry.sceneId];
		const durationInFrames = Math.max(
			1,
			Math.round(entry.durationSeconds * fps),
		);
		const from = cursor;
		cursor += durationInFrames;
		if (!scene) {
			return null;
		}
		return (
			<Sequence
				key={`${entry.sceneId}-${from}`}
				from={from}
				durationInFrames={durationInFrames}
			>
				<SceneLayer scene={scene} />
			</Sequence>
		);
	});

	// Deduped so a scene that (in principle) appeared more than once in the
	// timeline only primes its query cache entry once.
	const preloadScenes = useMemo(() => {
		const seen = new Set<string>();
		const scenes: Scene[] = [];
		for (const entry of timeline) {
			const scene = scenesById[entry.sceneId];
			if (scene && !seen.has(scene.id)) {
				seen.add(scene.id);
				scenes.push(scene);
			}
		}
		return scenes;
	}, [timeline, scenesById]);

	const activeEntry = findActiveTimelineEntry(timeline, frame, fps);
	const activeScene = activeEntry
		? (scenesById[activeEntry.entry.sceneId] ?? null)
		: null;
	// Frames-into-the-active-scene, converted to seconds — the same "seconds
	// into the scene" coordinate space `subtitleText` gets split across (see
	// `buildSubtitleCues`), so a cue's window lines up with the scene's own
	// timeline, not the whole composition's.
	const secondsIntoScene = activeEntry
		? (frame - activeEntry.startFrame) / fps
		: 0;
	// Splitting `subtitleText` into cues only depends on the active scene +
	// its authored duration (+ its real STT `speechCues`, when present), not
	// the current frame — memoized so this (sentence/clause regex work, or the
	// real-cues sort) doesn't re-run every single frame while
	// scrubbing/playing through the same scene, only when the scene changes.
	const activeSubtitleText = activeScene?.subtitleText ?? null;
	const activeSpeechCues = activeScene?.speechCues ?? null;
	const activeEntryDurationSeconds = activeEntry?.entry.durationSeconds ?? 0;
	const activeCues = useMemo(
		() =>
			resolveSubtitleCues(
				activeSubtitleText,
				activeEntryDurationSeconds,
				activeSpeechCues,
			),
		[activeSubtitleText, activeEntryDurationSeconds, activeSpeechCues],
	);
	const activeCueText = activeCueAt(activeCues, secondsIntoScene);

	return (
		<AbsoluteFill style={{ backgroundColor: STUDIO_BACKDROP_COLOR }}>
			{preloadScenes.map((scene) => (
				<ScenePreload key={scene.id} scene={scene} />
			))}
			{sequences}
			<SubtitleOverlay style={subtitleStyle} text={activeCueText} />
		</AbsoluteFill>
	);
}

/**
 * Renders nothing — exists purely to call `useAssetUrl` for a scene outside
 * of its `<Sequence>`'s mount lifecycle (see `StudioComposition` doc comment
 * above). Split into its own component (rather than called inline in a
 * `.map()`) because the timeline can reorder (drag-and-drop), which would
 * otherwise violate the Rules of Hooks.
 */
function ScenePreload({ scene }: { scene: Scene }) {
	const hasVideo =
		scene.status === SceneStatus.VIDEO_READY && Boolean(scene.videoAssetId);
	useAssetUrl(hasVideo ? scene.videoAssetId : null);
	return null;
}

function ScenePlaceholder({ scene }: { scene: Scene }) {
	const [from, to] = gradientForScene(scene.id);

	return (
		<AbsoluteFill
			style={{
				alignItems: "center",
				backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
				justifyContent: "center",
			}}
		>
			<div
				style={{
					color: "white",
					fontFamily: "sans-serif",
					fontSize: 52,
					fontWeight: 700,
					padding: "0 96px",
					textAlign: "center",
					textShadow: "0 2px 24px rgba(0, 0, 0, 0.35)",
				}}
			>
				{scene.title ?? "Untitled scene"}
			</div>
		</AbsoluteFill>
	);
}

/**
 * Faithful to the render (docs/studio-quality-pass.md §4): the Mediabunny
 * render just concatenates clips with hard cuts, so the preview must too — no
 * opacity fade at scene edges. `pauseWhenBuffering` (kept) + the up-front
 * `ScenePreload` cache-priming above are what keep playback gap-free instead.
 */
function SceneLayer({ scene }: { scene: Scene }) {
	const [videoErrored, setVideoErrored] = useState(false);
	const hasVideo =
		scene.status === SceneStatus.VIDEO_READY && Boolean(scene.videoAssetId);
	const { data: videoUrl } = useAssetUrl(hasVideo ? scene.videoAssetId : null);

	if (hasVideo && videoUrl && !videoErrored) {
		return (
			<AbsoluteFill>
				<OffthreadVideo
					src={videoUrl.url}
					pauseWhenBuffering
					onError={() => setVideoErrored(true)}
					style={{ height: "100%", objectFit: "cover", width: "100%" }}
				/>
			</AbsoluteFill>
		);
	}

	return <ScenePlaceholder scene={scene} />;
}

function SubtitleOverlay({
	text,
	style,
}: {
	text: string | null;
	style: SubtitleStyle;
}) {
	if (!text) {
		return null;
	}

	const containerStyle: CSSProperties = {
		alignItems: "center",
		display: "flex",
		justifyContent: style.position === "top" ? "flex-start" : "flex-end",
		padding: "5% 6%",
	};
	const { blurPx, opacity } = textShadowIntensityToPixels(
		style.textShadowIntensity ?? 50,
	);
	const textStyle: CSSProperties = {
		WebkitTextStroke: `2px ${style.outlineColor ?? "#000000"}`,
		backgroundColor: style.backgroundColor ?? "transparent",
		borderRadius: style.backgroundColor ? 10 : 0,
		color: style.color ?? "#ffffff",
		fontFamily: style.font ?? "Inter",
		fontSize: style.fontSize ?? 48,
		fontWeight:
			style.weight === "bold" ? 700 : style.weight === "medium" ? 600 : 400,
		lineHeight: style.lineHeight ?? 1.2,
		maxWidth: `${style.maxWidthPercent ?? 90}%`,
		padding: style.backgroundColor ? "0.35em 0.7em" : 0,
		paintOrder: "stroke fill",
		textAlign: "center",
		textShadow: style.textShadow
			? `0 2px ${blurPx}px rgba(0, 0, 0, ${opacity})`
			: "none",
	};

	return (
		<AbsoluteFill style={containerStyle}>
			<div style={textStyle}>{text}</div>
		</AbsoluteFill>
	);
}
