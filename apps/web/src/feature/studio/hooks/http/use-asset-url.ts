"use client";

import { skipToken, useQuery } from "@tanstack/react-query";

import { orpc } from "@/libs/orpc";

// Server-signed download URLs default to a 1h TTL (packages/storage
// `DEFAULT_DOWNLOAD_EXPIRES_IN_SECONDS`). Stale comfortably before that so a
// long-open Studio tab never hands the Player/thumbnails an expired URL, but
// well past any single render/hover so it isn't refetched on every access.
const ASSET_URL_STALE_TIME_MS = 45 * 60 * 1000;

/**
 * Signed GET URL for one asset (docs/studio-ui.md §1 Player/timeline
 * thumbnails, the asset browser). `assetId` may be `null`/`undefined` while a
 * scene hasn't produced that asset yet (e.g. `startKeyframeAssetId` before
 * `keyframe_ready`) — the query is skipped entirely rather than firing with
 * an empty id, via oRPC's `skipToken` input support. Call sites that need
 * several asset URLs at once (the Player's timeline, the Assets tab) just
 * call this once per id — TanStack Query dedupes and parallelizes them.
 */
export function useAssetUrl(assetId: string | null | undefined) {
	return useQuery(
		orpc.assets.getDownloadUrl.queryOptions({
			input: assetId ? { id: assetId } : skipToken,
			staleTime: ASSET_URL_STALE_TIME_MS,
		}),
	);
}
