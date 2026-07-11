"use client";

import { useEffect, useState } from "react";

/**
 * True after the first client render. Use to gate theme-dependent UI that
 * would otherwise mismatch between SSR (no resolved theme) and hydration.
 */
export function useMounted() {
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	return mounted;
}
