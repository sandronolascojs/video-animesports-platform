"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Module-level, lazily-computed + cached platform detection — computed once
 * per page load (not once per hook call), not at module-evaluation time
 * (SSR-safe: `navigator` doesn't exist on the server, so this only runs on
 * first client access, typically the first `usePlatform()`/`useShortcut()`
 * call).
 */
let cachedIsMac: boolean | null = null;

function detectIsMac(): boolean {
	if (cachedIsMac !== null) {
		return cachedIsMac;
	}
	if (typeof navigator === "undefined") {
		return false;
	}
	// `||`, not the usual `??`: on real-world Chrome/Mac,
	// `userAgentData.platform` can resolve to `""` (empty string), not
	// `null`/`undefined`. `??` only falls through on nullish values, so an
	// empty string would win and this would never reach `navigator.platform`
	// — `isMac` would be permanently `false` on Mac. `||` treats the empty
	// string as "no value" too, which is what we actually want here.
	const platform =
		(navigator as Navigator & { userAgentData?: { platform?: string } })
			.userAgentData?.platform ||
		navigator.platform ||
		"";
	cachedIsMac = /mac/i.test(platform);
	return cachedIsMac;
}

/**
 * True when `event` carries this platform's "mod" modifier — `metaKey` (⌘)
 * on Mac, `ctrlKey` elsewhere. Deliberately platform-EXACT (not `metaKey ||
 * ctrlKey`, which the ad-hoc listeners this hook replaces used): on macOS
 * only ⌘ counts, everywhere else only Ctrl counts, matching each OS's own
 * convention instead of accepting both everywhere.
 */
export function isModEvent(event: KeyboardEvent): boolean {
	return detectIsMac() ? event.metaKey : event.ctrlKey;
}

export type UsePlatformResult = {
	isMac: boolean;
	modLabel: "⌘" | "Ctrl";
	isModEvent: (event: KeyboardEvent) => boolean;
};

/**
 * Cached platform info + the mod-key predicate, for kbd hints and
 * platform-aware copy.
 *
 * `isMac`/`modLabel` are gated behind a `mounted` flag (same pattern as
 * `AIDockInput`'s `resolvedTheme` gating — see
 * `components/app/ai-dock/ai-dock-input.tsx`): the server has no
 * `navigator`, so it always renders the `isMac:false`/`"Ctrl"` default.
 * Returning the *real* detected value on the client's first render would
 * mismatch that SSR output whenever the client actually is a Mac, which
 * React flags as a hydration error. Staying on the SSR-safe default until
 * `mounted` flips (via `useEffect`, i.e. after the first commit) guarantees
 * the first client render matches the server, then a second render picks up
 * the real value.
 *
 * `isModEvent` is NOT gated this way — it's only ever called from inside
 * event handlers (never rendered into DOM text), so it has no
 * hydration-mismatch risk, and gating it would leave keyboard shortcuts dead
 * until after this mount-triggered re-render.
 */
export function usePlatform(): UsePlatformResult {
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	const isMac = mounted && detectIsMac();
	return {
		isMac,
		isModEvent,
		modLabel: isMac ? "⌘" : "Ctrl",
	};
}

// ---- Global shortcut registry -------------------------------------------
//
// Exactly ONE `window` "keydown" listener backs every `useShortcut` call in
// the app: a module-level `key -> Set<entry>` registry, attached lazily on
// the first subscriber and torn down once the last one unregisters. Every
// `useShortcut` call is just a registry add/remove — no component ever
// attaches its own listener.

type ShortcutHandler = (event: KeyboardEvent) => void;

type ShortcutEntry = {
	handler: ShortcutHandler;
	allowRepeat: boolean;
};

const registry = new Map<string, Set<ShortcutEntry>>();
let listenerAttached = false;

/** Splits an optional leading `"shift+"` token off a normalized key string. */
function parseShortcutKey(key: string): { base: string; shift: boolean } {
	const parts = key.toLowerCase().split("+");
	const shift = parts.includes("shift");
	const base = parts.filter((part) => part !== "shift").join("+");
	return { base, shift };
}

function registryKey(base: string, shift: boolean): string {
	return shift ? `shift+${base}` : base;
}

function handleGlobalKeyDown(event: KeyboardEvent) {
	if (!isModEvent(event)) {
		return;
	}
	const entries = registry.get(
		registryKey(event.key.toLowerCase(), event.shiftKey),
	);
	if (!entries || entries.size === 0) {
		return;
	}
	for (const entry of entries) {
		if (event.repeat && !entry.allowRepeat) {
			continue;
		}
		event.preventDefault();
		entry.handler(event);
	}
}

function subscribe(key: string, entry: ShortcutEntry): () => void {
	const { base, shift } = parseShortcutKey(key);
	const composite = registryKey(base, shift);

	let entries = registry.get(composite);
	if (!entries) {
		entries = new Set();
		registry.set(composite, entries);
	}
	entries.add(entry);

	if (!listenerAttached) {
		window.addEventListener("keydown", handleGlobalKeyDown);
		listenerAttached = true;
	}

	return () => {
		entries?.delete(entry);
		if (entries && entries.size === 0) {
			registry.delete(composite);
		}
		if (registry.size === 0 && listenerAttached) {
			window.removeEventListener("keydown", handleGlobalKeyDown);
			listenerAttached = false;
		}
	};
}

export type UseShortcutOptions = {
	enabled?: boolean;
	/**
	 * Fire on OS key-repeat events too (holding the combo down). Default
	 * `false` — one call per physical key press, which is right for toggles
	 * (⌘K) but wrong for undo/redo, which opt in so holding ⌘Z keeps undoing.
	 */
	allowRepeat?: boolean;
};

/**
 * Registers a mod+key shortcut (⌘ on Mac, Ctrl elsewhere — see `isModEvent`)
 * against the single shared registry above. `key` is normalized lowercase
 * and may carry a `"shift+"` prefix (e.g. `"shift+z"` for ⌘⇧Z) — plain `"z"`
 * and `"shift+z"` are registered and matched independently, so an ⌘Z
 * subscriber never also fires on ⌘⇧Z.
 *
 * Re-render-safe by construction: `handler` is stashed in a ref and read
 * through a permanently-stable wrapper (`useCallback` with an empty
 * dependency array), so the effect that (un)registers with the registry
 * only depends on `key`/`enabled`/`allowRepeat` — passing a new inline
 * handler every render never churns the listener registration.
 */
export function useShortcut(
	key: string,
	handler: ShortcutHandler,
	opts: UseShortcutOptions = {},
): void {
	const { enabled = true, allowRepeat = false } = opts;

	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	const stableHandler = useCallback((event: KeyboardEvent) => {
		handlerRef.current(event);
	}, []);

	useEffect(() => {
		if (!enabled) {
			return;
		}
		return subscribe(key, { allowRepeat, handler: stableHandler });
	}, [key, enabled, allowRepeat, stableHandler]);
}
