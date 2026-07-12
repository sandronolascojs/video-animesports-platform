"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { usePlayerRefContext } from "@/feature/studio/stores/player-ref-context";

export type PlayerPlayback = {
	/** Current player frame — updated from the `frameupdate` event, rAF-throttled to at most one state update per animation frame. */
	frame: number;
	isPlaying: boolean;
	/** Seeks the player and optimistically applies `frame` locally (the player's own `frameupdate`/`seeked` events confirm it right after). */
	seekTo: (frame: number) => void;
	play: () => void;
	pause: () => void;
	togglePlayback: () => void;
	/** Synchronous read of the player's play state — for scrub-start bookkeeping (`isPlaying` state can lag by a render). */
	isPlayingNow: () => boolean;
};

/**
 * Single source of playback truth for the timeline (docs' "Current-time
 * readout... single source of truth = player state"): subscribes to the
 * shared `PlayerRef` (see `player-ref-context.tsx`) for `frameupdate`/`play`/
 * `pause` events instead of polling, so the timeline header, playhead, and
 * play/pause button all read the same live state the Player itself reports.
 */
export function usePlayerPlayback(): PlayerPlayback {
	const { playerRef, isReady } = usePlayerRefContext();
	const [frame, setFrame] = useState(0);
	const [isPlaying, setIsPlaying] = useState(false);
	const rafIdRef = useRef<number | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `isReady` isn't read in the effect body, but it's the signal that `playerRef.current` just got populated (a plain ref mutation doesn't itself trigger a re-run) — dropping it would leave this effect subscribed to nothing until some unrelated re-render happened to fire first.
	useEffect(() => {
		const player = playerRef.current;
		if (!player) {
			return;
		}

		setFrame(player.getCurrentFrame());
		setIsPlaying(player.isPlaying());

		// Coalesces bursts of `frameupdate` dispatches into at most one
		// `setFrame` per animation frame: `pendingFrame` always holds the LATEST
		// frame (updated synchronously on every dispatch), while the scheduled
		// rAF callback only fires once per tick and reads it at flush time — so
		// a burst never gets stuck applying the first frame in the batch instead
		// of the last.
		let pendingFrame: number | null = null;
		const flushPendingFrame = () => {
			rafIdRef.current = null;
			if (pendingFrame !== null) {
				setFrame(pendingFrame);
				pendingFrame = null;
			}
		};
		const onFrameUpdate = (event: { detail: { frame: number } }) => {
			pendingFrame = event.detail.frame;
			if (rafIdRef.current === null) {
				rafIdRef.current = requestAnimationFrame(flushPendingFrame);
			}
		};
		const onSeeked = (event: { detail: { frame: number } }) => {
			setFrame(event.detail.frame);
		};
		const onPlay = () => setIsPlaying(true);
		const onPause = () => setIsPlaying(false);

		player.addEventListener("frameupdate", onFrameUpdate);
		player.addEventListener("seeked", onSeeked);
		player.addEventListener("play", onPlay);
		player.addEventListener("pause", onPause);

		return () => {
			player.removeEventListener("frameupdate", onFrameUpdate);
			player.removeEventListener("seeked", onSeeked);
			player.removeEventListener("play", onPlay);
			player.removeEventListener("pause", onPause);
			if (rafIdRef.current !== null) {
				cancelAnimationFrame(rafIdRef.current);
				rafIdRef.current = null;
			}
		};
	}, [playerRef, isReady]);

	const seekTo = useCallback(
		(nextFrame: number) => {
			playerRef.current?.seekTo(nextFrame);
			setFrame(nextFrame);
		},
		[playerRef],
	);

	const play = useCallback(() => playerRef.current?.play(), [playerRef]);
	const pause = useCallback(() => playerRef.current?.pause(), [playerRef]);
	const togglePlayback = useCallback(
		() => playerRef.current?.toggle(),
		[playerRef],
	);
	const isPlayingNow = useCallback(
		() => playerRef.current?.isPlaying() ?? false,
		[playerRef],
	);

	return {
		frame,
		isPlaying,
		isPlayingNow,
		pause,
		play,
		seekTo,
		togglePlayback,
	};
}
