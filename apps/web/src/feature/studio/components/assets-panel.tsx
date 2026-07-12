"use client";

import type { Asset } from "@video-platform-challenge/api";
import { AssetKind, AssetStatus } from "@video-platform-challenge/types";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAssetUrl } from "@/feature/studio/hooks/http/use-asset-url";
import { useStudio } from "@/feature/studio/stores/use-studio";

const KIND_LABEL: Record<Asset["kind"], string> = {
	character_sheet: "Character sheet",
	keyframe: "Keyframe",
	location_sheet: "Location sheet",
	render: "Render",
	scene_audio: "Scene audio",
	scene_video: "Scene video",
};

// Preview images inline; audio/video/render rows show a kind badge instead
// of trying to inline-play/download from a grid cell.
const PREVIEWABLE_KINDS: readonly Asset["kind"][] = [
	AssetKind.CHARACTER_SHEET,
	AssetKind.LOCATION_SHEET,
	AssetKind.KEYFRAME,
];

function AssetThumbnail({ asset }: { asset: Asset }) {
	const previewable =
		asset.status === AssetStatus.READY &&
		PREVIEWABLE_KINDS.includes(asset.kind);
	const { data } = useAssetUrl(previewable ? asset.id : null);

	if (!previewable) {
		return (
			<span className="flex aspect-video w-full items-center justify-center bg-muted text-[10px] text-muted-foreground uppercase tracking-wide">
				{asset.status === AssetStatus.FAILED
					? "Failed"
					: KIND_LABEL[asset.kind]}
			</span>
		);
	}

	if (!data) {
		return <Skeleton className="aspect-video w-full rounded-none" />;
	}

	return (
		// biome-ignore lint/performance/noImgElement: signed R2 URLs are short-lived and per-asset.
		<img
			src={data.url}
			alt={KIND_LABEL[asset.kind]}
			className="aspect-video w-full object-cover"
		/>
	);
}

/** Assets tab (docs/studio-ui.md §1): generated assets browser. */
export function AssetsPanel() {
	const { assets } = useStudio();

	if (assets.length === 0) {
		return (
			<p className="px-1 text-muted-foreground text-xs">
				No assets generated yet.
			</p>
		);
	}

	return (
		<div className="grid h-full min-h-0 auto-rows-min grid-cols-2 gap-2 overflow-y-auto pr-1">
			{assets.map((asset) => (
				<div
					key={asset.id}
					className="flex flex-col gap-1.5 overflow-hidden rounded-xl border border-border/60"
				>
					<AssetThumbnail asset={asset} />
					<div className="flex items-center justify-between gap-2 px-2 pb-2">
						<p className="truncate text-[10px] text-muted-foreground">
							{KIND_LABEL[asset.kind]}
						</p>
						{asset.status !== AssetStatus.READY ? (
							<Badge
								variant={
									asset.status === AssetStatus.FAILED
										? "destructive"
										: "secondary"
								}
								className="h-4 shrink-0 px-1.5 text-[9px] capitalize"
							>
								{asset.status}
							</Badge>
						) : null}
					</div>
				</div>
			))}
		</div>
	);
}
