"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo } from "react";

import { orpc } from "@/libs/orpc";

// Batch signed-URL TTL is 1h server-side; stale well before that but well past
// any render so the map isn't refetched on every access.
const ASSET_URL_STALE_TIME_MS = 45 * 60 * 1000;

// Same shape the old per-asset signed-URL query resolved to, so every consumer
// keeps reading `.data.url` unchanged after the switch to the batch endpoint.
type ResolvedAssetUrl = { url: string; expiresAt: Date };

type AssetUrlResolver = {
	resolve: (assetId: string | null | undefined) => ResolvedAssetUrl | undefined;
	isLoading: boolean;
};

const ProjectAssetUrlsContext = createContext<AssetUrlResolver | null>(null);

/**
 * Fetches EVERY signed asset URL for one project in a single `getProjectUrls`
 * call and exposes a lookup — replacing the old per-asset download fan-out
 * (one network request per thumbnail/clip on screen). Mounted once per
 * project subtree (Studio root, and the dashboard's latest-project asset grid).
 */
export function ProjectAssetUrlsProvider({
	projectId,
	children,
}: {
	projectId: string;
	children: ReactNode;
}) {
	const query = useQuery(
		orpc.assets.getProjectUrls.queryOptions({
			input: { projectId },
			staleTime: ASSET_URL_STALE_TIME_MS,
		}),
	);

	const value = useMemo<AssetUrlResolver>(() => {
		const map = new Map(
			(query.data ?? []).map((entry): [string, ResolvedAssetUrl] => [
				entry.assetId,
				{ url: entry.url, expiresAt: entry.expiresAt },
			]),
		);
		return {
			resolve: (assetId) => (assetId ? map.get(assetId) : undefined),
			isLoading: query.isLoading,
		};
	}, [query.data, query.isLoading]);

	return (
		<ProjectAssetUrlsContext.Provider value={value}>
			{children}
		</ProjectAssetUrlsContext.Provider>
	);
}

/**
 * Signed GET URL for one asset, resolved from the project's already-fetched
 * batch (no per-asset request). Must be called under a `ProjectAssetUrlsProvider`.
 * Returns the same `{ data, isLoading }` shape the old query hook did, where
 * `data` is `{ url, expiresAt } | undefined`.
 */
export function useAssetUrl(assetId: string | null | undefined): {
	data: ResolvedAssetUrl | undefined;
	isLoading: boolean;
} {
	const ctx = useContext(ProjectAssetUrlsContext);
	if (!ctx) {
		throw new Error(
			"useAssetUrl must be used within a ProjectAssetUrlsProvider",
		);
	}
	return { data: ctx.resolve(assetId), isLoading: ctx.isLoading };
}
