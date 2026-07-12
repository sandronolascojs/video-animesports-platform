"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { AssetsPageInput } from "@video-platform-challenge/api";

import { orpc } from "@/libs/orpc";

/**
 * Paginated asset cards (`assets.page`) — `keepPreviousData` so page flips
 * and kind-filter changes swap in place instead of flashing empty.
 */
export function useAssetsPage(input: AssetsPageInput, enabled = true) {
	return useQuery({
		...orpc.assets.page.queryOptions({ input }),
		enabled,
		placeholderData: keepPreviousData,
	});
}
