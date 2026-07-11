"use client";

import { useEffect, useState } from "react";

/**
 * Returns `value` after it has held still for `delayMs` — the standard
 * keystroke → network-request valve (command palette search, etc.). Each
 * change resets the timer; the previous timeout is always cleared, so only
 * the final value of a burst ever lands.
 */
export function useDebounce<T>(value: T, delayMs = 250): T {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timeout = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timeout);
	}, [value, delayMs]);

	return debounced;
}
