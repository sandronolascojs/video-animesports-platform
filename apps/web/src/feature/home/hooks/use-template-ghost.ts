"use client";

import { useCallback, useState } from "react";

/**
 * Home's "hover fills the input" interaction (docs/studio-ui.md Home): a
 * hovered template card previews its example prompt as ghost text in the
 * hero composer — the caller only reads `ghostText` while the input value is
 * empty, so hover never overrides text the user already typed. Clicking
 * commits the prompt as real input value and marks the card selected (ring).
 */
export function useTemplateGhost() {
	const [hoveredKey, setHoveredKey] = useState<string | null>(null);
	const [selectedKey, setSelectedKey] = useState<string | null>(null);

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

	const select = useCallback((key: string) => {
		setSelectedKey(key);
	}, []);

	return { hoveredKey, onHoverChange, select, selectedKey };
}
