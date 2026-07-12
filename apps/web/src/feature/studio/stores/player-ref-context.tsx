"use client";

import type { PlayerRef } from "@remotion/player";
import {
	createContext,
	type ReactNode,
	type RefObject,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";

type PlayerRefContextValue = {
	/** Mutable ref to the mounted `@remotion/player` instance — never causes a re-render on its own. */
	playerRef: RefObject<PlayerRef | null>;
	/** Pass as the `<Player ref={...}>` prop (`player-canvas.tsx`) — flips `isReady` once the instance mounts. */
	registerPlayer: (instance: PlayerRef | null) => void;
	/** True once `playerRef.current` is populated — consumers gate their `addEventListener` effects on this. */
	isReady: boolean;
};

const PlayerRefContext = createContext<PlayerRefContextValue | null>(null);

/**
 * Smallest clean mechanism to share the `@remotion/player` imperative handle
 * between `PlayerCanvas` (mounts it) and the timeline (reads/drives it for
 * scrub + playhead sync) without threading a ref prop through
 * `StudioView`/`StudioViewInner` — both are siblings under this provider.
 */
export function PlayerRefProvider({ children }: { children: ReactNode }) {
	const playerRef = useRef<PlayerRef | null>(null);
	const [isReady, setIsReady] = useState(false);

	const registerPlayer = useCallback((instance: PlayerRef | null) => {
		playerRef.current = instance;
		setIsReady(instance !== null);
	}, []);

	const value = useMemo(
		() => ({ isReady, playerRef, registerPlayer }),
		[isReady, registerPlayer],
	);

	return (
		<PlayerRefContext.Provider value={value}>
			{children}
		</PlayerRefContext.Provider>
	);
}

export function usePlayerRefContext(): PlayerRefContextValue {
	const context = useContext(PlayerRefContext);
	if (!context) {
		throw new Error(
			"usePlayerRefContext must be used within a PlayerRefProvider",
		);
	}
	return context;
}
