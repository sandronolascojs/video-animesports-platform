"use client";

import type {
	Scene,
	SubtitleStyle,
	TimelineEntry,
} from "@video-platform-challenge/api";
import { SceneStatus } from "@video-platform-challenge/types";
import type { CSSProperties } from "react";
import { useState } from "react";
import {
	AbsoluteFill,
	interpolate,
	OffthreadVideo,
	Sequence,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";

import { useAssetUrl } from "@/feature/studio/hooks/http/use-asset-url";
import { STUDIO_BACKDROP_COLOR } from "@/feature/studio/lib/subtitle-canvas";
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

/** Exported for `composition.test.ts` — pure, zero-DOM, so it's covered directly without mounting the Player. */
export function findActiveScene(
	timeline: TimelineEntry[],
	scenesById: Record<string, Scene>,
	frame: number,
	fps: number,
): Scene | null {
	let cursor = 0;
	for (const entry of timeline) {
		const durationInFrames = Math.max(
			1,
			Math.round(entry.durationSeconds * fps),
		);
		if (frame < cursor + durationInFrames) {
			return scenesById[entry.sceneId] ?? null;
		}
		cursor += durationInFrames;
	}
	return null;
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
 * plays it via `OffthreadVideo` (signed URL from `assets.getDownloadUrl`,
 * fetched per-scene — all Sequences mount concurrently in Remotion, so this
 * naturally batches into parallel queries per docs' "fetch URLs in parallel"
 * note); every other status renders the gradient + title placeholder, plus a
 * subtitle overlay live-styled from `subtitleStyle` so the Subtitles tab
 * previews in real time on the Player.
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
				<SceneLayer scene={scene} durationInFrames={durationInFrames} />
			</Sequence>
		);
	});

	const activeScene = findActiveScene(timeline, scenesById, frame, fps);

	return (
		<AbsoluteFill style={{ backgroundColor: STUDIO_BACKDROP_COLOR }}>
			{sequences}
			<SubtitleOverlay
				style={subtitleStyle}
				text={activeScene?.subtitleText ?? null}
			/>
		</AbsoluteFill>
	);
}

function ScenePlaceholder({
	scene,
	opacity,
}: {
	scene: Scene;
	opacity: number;
}) {
	const [from, to] = gradientForScene(scene.id);

	return (
		<AbsoluteFill
			style={{
				alignItems: "center",
				backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
				justifyContent: "center",
				opacity,
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

function SceneLayer({
	scene,
	durationInFrames,
}: {
	scene: Scene;
	durationInFrames: number;
}) {
	const frame = useCurrentFrame();
	const fadeFrames =
		durationInFrames > 8 ? Math.min(8, Math.floor(durationInFrames / 4)) : 0;
	const opacity =
		fadeFrames > 0
			? interpolate(
					frame,
					[0, fadeFrames, durationInFrames - fadeFrames, durationInFrames],
					[0, 1, 1, 0],
					{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
				)
			: 1;

	const [videoErrored, setVideoErrored] = useState(false);
	const hasVideo =
		scene.status === SceneStatus.VIDEO_READY && Boolean(scene.videoAssetId);
	const { data: videoUrl } = useAssetUrl(hasVideo ? scene.videoAssetId : null);

	if (hasVideo && videoUrl && !videoErrored) {
		return (
			<AbsoluteFill style={{ opacity }}>
				<OffthreadVideo
					src={videoUrl.url}
					pauseWhenBuffering
					onError={() => setVideoErrored(true)}
					style={{ height: "100%", objectFit: "cover", width: "100%" }}
				/>
			</AbsoluteFill>
		);
	}

	return <ScenePlaceholder scene={scene} opacity={opacity} />;
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
	const textStyle: CSSProperties = {
		WebkitTextStroke: `2px ${style.outlineColor ?? "#000000"}`,
		backgroundColor: style.backgroundColor ?? "transparent",
		borderRadius: style.backgroundColor ? 10 : 0,
		color: style.color ?? "#ffffff",
		fontFamily: style.font ?? "Inter",
		fontSize: style.fontSize ?? 48,
		fontWeight:
			style.weight === "bold" ? 700 : style.weight === "medium" ? 600 : 400,
		maxWidth: "90%",
		padding: style.backgroundColor ? "0.35em 0.7em" : 0,
		paintOrder: "stroke fill",
		textAlign: "center",
	};

	return (
		<AbsoluteFill style={containerStyle}>
			<div style={textStyle}>{text}</div>
		</AbsoluteFill>
	);
}
