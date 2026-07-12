"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ProjectsPageInput } from "@video-platform-challenge/api";

import { orpc } from "@/libs/orpc";

/**
 * Paginated project cards (`projects.page`) — `keepPreviousData` so page
 * flips swap in place instead of flashing empty.
 */
export function useProjectsPage(input: ProjectsPageInput) {
	return useQuery({
		...orpc.projects.page.queryOptions({ input }),
		placeholderData: keepPreviousData,
	});
}
