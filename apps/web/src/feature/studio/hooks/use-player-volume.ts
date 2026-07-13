"use client";

import { useCallback, useEffect, useState } from "react";

import { usePlayerRefContext } from "@/feature/studio/stores/player-ref-context";

export type PlayerVolume = {
	/** 0..1, mirrors `PlayerRef.getVolume()`. */
	volume: number;
	isMuted: boolean;
	/** Sets the player's volume; unmutes first if the player is currently muted and the new volume is audible. */
	setVolume: (volume: number) => void;
	toggleMute: () => void;
};

/**
 * Mirrors `use-player-playback.ts`'s pattern: subscribes to the shared
 * `PlayerRef` (see `player-ref-context.tsx`) for `volumechange`/`mutechange`
 * events instead of polling, so the custom control bar's volume button/slider
 * (`player-controls.tsx`) always reflects the Player's own live state.
 */
export function usePlayerVolume(): PlayerVolume {
	const { playerRef, isReady } = usePlayerRefContext();
	const [volume, setVolumeState] = useState(1);
	const [isMuted, setIsMuted] = useState(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `isReady` isn't read in the effect body, but it's the signal that `playerRef.current` just got populated (a plain ref mutation doesn't itself trigger a re-run) — see the identical rationale in `use-player-playback.ts`.
	useEffect(() => {
		const player = playerRef.current;
		if (!player) {
			return;
		}

		setVolumeState(player.getVolume());
		setIsMuted(player.isMuted());

		const onVolumeChange = () => setVolumeState(player.getVolume());
		const onMuteChange = () => setIsMuted(player.isMuted());

		player.addEventListener("volumechange", onVolumeChange);
		player.addEventListener("mutechange", onMuteChange);

		return () => {
			player.removeEventListener("volumechange", onVolumeChange);
			player.removeEventListener("mutechange", onMuteChange);
		};
	}, [playerRef, isReady]);

	const setVolume = useCallback(
		(nextVolume: number) => {
			const player = playerRef.current;
			if (!player) {
				return;
			}
			if (nextVolume > 0 && player.isMuted()) {
				player.unmute();
			}
			player.setVolume(nextVolume);
		},
		[playerRef],
	);

	const toggleMute = useCallback(() => {
		const player = playerRef.current;
		if (!player) {
			return;
		}
		if (player.isMuted()) {
			player.unmute();
		} else {
			player.mute();
		}
	}, [playerRef]);

	return { isMuted, setVolume, toggleMute, volume };
}
