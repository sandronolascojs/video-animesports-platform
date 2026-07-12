"use client";

import { useQueries } from "@tanstack/react-query";
import type { ProjectDetail } from "@video-platform-challenge/api";

// Cross-feature import (home owns the projects list hook): same cache entry
// the dashboard and sidebar already share.
import { useProjects } from "@/feature/home/hooks/http/use-projects";
import { orpc } from "@/libs/orpc";

export type AssetWithProject = {
	asset: ProjectDetail["assets"][number];
	projectId: string;
	projectTitle: string;
};

/**
 * Every asset across the caller's projects, flattened with its project's
 * title — feeds the Assets page grid and the command palette's Assets group.
 * There is no all-assets endpoint (assets hang off `projects.get`), so this
 * fans out one detail query per project; fine at this product's scale, and
 * each detail shares the query cache with the Studio/dashboard consumers of
 * the same key. `enabled` gates the fan-out so the palette doesn't fetch
 * until it's actually opened.
 */
export function useAllAssets(enabled = true) {
	const { data: projects = [] } = useProjects();

	const detailQueries = useQueries({
		queries: projects.map((project) => ({
			...orpc.projects.get.queryOptions({ input: { id: project.id } }),
			enabled,
		})),
	});

	const assets: AssetWithProject[] = detailQueries.flatMap((query, index) => {
		const project = projects[index];
		if (!query.data || !project) {
			return [];
		}
		return query.data.assets.map((asset) => ({
			asset,
			projectId: project.id,
			projectTitle: project.title ?? "Untitled project",
		}));
	});

	return {
		assets,
		isLoading:
			projects.length > 0 && detailQueries.some((query) => query.isLoading),
	};
}
