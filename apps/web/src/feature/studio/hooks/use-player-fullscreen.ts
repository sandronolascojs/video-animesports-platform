"use client";

import { useCallback, useEffect, useState } from "react";

import { usePlayerRefContext } from "@/feature/studio/stores/player-ref-context";

export type PlayerFullscreen = {
	/** False in browsers without the Fullscreen API (e.g. Safari on iOS) — the fullscreen control should hide itself rather than throw on click. */
	isSupported: boolean;
	isFullscreen: boolean;
	toggleFullscreen: () => void;
};

/**
 * Same event-subscription shape as `use-player-playback.ts`/
 * `use-player-volume.ts`, for the custom control bar's fullscreen button
 * (`player-controls.tsx`). Feature detection runs client-side only (a
 * `document.fullscreenEnabled` read during SSR would mismatch hydration).
 */
export function usePlayerFullscreen(): PlayerFullscreen {
	const { playerRef, isReady } = usePlayerRefContext();
	const [isSupported, setIsSupported] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);

	useEffect(() => {
		setIsSupported(
			typeof document !== "undefined" &&
				(document.fullscreenEnabled ??
					// @ts-expect-error webkit-prefixed fallback, no official types
					Boolean(document.webkitFullscreenEnabled)),
		);
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `isReady` isn't read in the effect body — same rationale as the sibling player hooks.
	useEffect(() => {
		const player = playerRef.current;
		if (!player) {
			return;
		}

		setIsFullscreen(player.isFullscreen());

		const onFullscreenChange = () => setIsFullscreen(player.isFullscreen());
		player.addEventListener("fullscreenchange", onFullscreenChange);
		return () => {
			player.removeEventListener("fullscreenchange", onFullscreenChange);
		};
	}, [playerRef, isReady]);

	const toggleFullscreen = useCallback(() => {
		const player = playerRef.current;
		if (!player) {
			return;
		}
		if (player.isFullscreen()) {
			player.exitFullscreen();
		} else {
			player.requestFullscreen();
		}
	}, [playerRef]);

	return { isFullscreen, isSupported, toggleFullscreen };
}
