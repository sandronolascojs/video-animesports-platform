"use client";

import { useCallback, useState } from "react";

/**
 * Home's "hover fills the input" interaction (docs/studio-ui.md Home): a
 * hovered template card previews its example prompt as ghost text in the
 * hero composer — the caller only reads `ghostText` while the input value is
 * empty, so hover never overrides text the user already typed. Clicking a
 * card commits the prompt as real input value only — no persistent selected
 * state: a click loads the prompt, it never "marks" the card.
 */
export function useTemplateGhost() {
	const [hoveredKey, setHoveredKey] = useState<string | null>(null);

	const onHoverChange = useCallback(
		(key: string) => (hovering: boolean) => {
			setHoveredKey((current) => {
				if (hovering) {
					return key;
				}
				return current === key ? null : current;
			});
		},
		[],
	);

	return { hoveredKey, onHoverChange };
}
