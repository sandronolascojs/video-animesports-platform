"use client";

import type { AssetPageItem } from "@video-platform-challenge/api";
import {
	AssetSortField,
	AssetStatus,
	MAX_PAGE_SIZE,
	SortDirection,
} from "@video-platform-challenge/types";
import {
	ClapperboardIcon,
	ImageIcon,
	ImagesIcon,
	type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useQueryStates } from "nuqs";
import { useEffect } from "react";

import { ErrorStateCard } from "@/components/kit/error-state-card";
import { FrostedImage, FrostedVideo } from "@/components/kit/frosted-media";
import { JewelIcon } from "@/components/kit/jewel-icon";
import { MediaCard, MediaCardSkeleton } from "@/components/kit/media-card";
import { FilterRow, ResourceFilters } from "@/components/kit/resource-filters";
import { ResourceLayout } from "@/components/kit/resource-layout";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useAssetsPage } from "@/feature/assets/hooks/http/use-assets-page";
// Cross-feature imports (home owns the empty-state card + template config;
// studio owns signed asset URLs).
import { EmptyStateCard } from "@/feature/home/components/dashboard-sections";
import { SPORT_TEMPLATES } from "@/feature/home/sport-templates";
import { useAssetUrl } from "@/feature/studio/hooks/http/use-asset-url";
import { assetsPageParams } from "@/libs/pagination/search-params";
import { toast } from "@/libs/toast";

const ASSET_KIND_ICON: Record<string, LucideIcon> = {
	character_sheet: ImageIcon,
	location_sheet: ImageIcon,
	keyframe: ImageIcon,
	scene_video: ClapperboardIcon,
	render: ClapperboardIcon,
};

const IMAGE_KINDS = new Set(["character_sheet", "location_sheet", "keyframe"]);
const VIDEO_KINDS = new Set(["scene_video", "render"]);

const KIND_FILTER_OPTIONS = [
	{ label: "All kinds", value: "all" },
	{ label: "Character sheet", value: "character_sheet" },
	{ label: "Location sheet", value: "location_sheet" },
	{ label: "Keyframe", value: "keyframe" },
	{ label: "Scene video", value: "scene_video" },
	{ label: "Render", value: "render" },
];

function kindLabel(kind: string): string {
	const label = kind.replace(/_/g, " ");
	return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Signed preview by kind: image, looping video, or an icon well for audio. */
function AssetMedia({
	item,
	controls = false,
}: {
	item: AssetPageItem;
	controls?: boolean;
}) {
	const { data: signed } = useAssetUrl(item.id);
	const Icon = ASSET_KIND_ICON[item.kind] ?? ImageIcon;

	// Frosted wells: portrait/9:16 media renders contained over a blurred
	// cover copy of itself (chat-input glass language) — the well stays 16:9
	// everywhere.
	if (signed?.url && IMAGE_KINDS.has(item.kind)) {
		return <FrostedImage src={signed.url} alt={kindLabel(item.kind)} />;
	}
	if (signed?.url && VIDEO_KINDS.has(item.kind)) {
		return <FrostedVideo src={signed.url} controls={controls} />;
	}
	return (
		<div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
			<Icon className="size-6 text-muted-foreground/60" />
		</div>
	);
}

/**
 * Asset info modal — media left, info right (user call): kind title, the
 * owning scene's prompt, status/created meta, and the linked project with
 * an "Open project" jump to the Studio.
 */
function AssetModal({
	item,
	onClose,
}: {
	item: AssetPageItem | undefined;
	onClose: () => void;
}) {
	const router = useRouter();
	const template = item
		? SPORT_TEMPLATES.find(
				(candidate) => candidate.key === item.projectTemplateKey,
			)
		: undefined;

	return (
		<Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="p-0 sm:max-w-3xl">
				{item ? (
					<div className="grid gap-0 sm:grid-cols-[3fr_2fr]">
						<div className="relative aspect-video overflow-hidden rounded-l-xl bg-black/40 max-sm:rounded-t-xl max-sm:rounded-l-none sm:aspect-auto sm:min-h-[22rem]">
							<AssetMedia item={item} controls />
						</div>
						<div className="flex flex-col gap-4 p-5">
							<DialogHeader className="space-y-1 text-left">
								<DialogTitle>{kindLabel(item.kind)}</DialogTitle>
								<DialogDescription>
									{item.scenePrompt ??
										"Project-level asset — not tied to a single scene."}
								</DialogDescription>
							</DialogHeader>

							<dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
								<dt className="text-muted-foreground">Status</dt>
								<dd className="capitalize">{item.status}</dd>
								<dt className="text-muted-foreground">Created</dt>
								<dd>{item.createdAt.toLocaleDateString()}</dd>
							</dl>

							<div className="glass-edge mt-auto flex items-center gap-3 rounded-xl bg-card/50 p-3">
								<JewelIcon
									icon={template?.icon ?? ClapperboardIcon}
									from={template?.gradient.from}
									to={template?.gradient.to}
									size={34}
								/>
								<div className="min-w-0 flex-1">
									<p className="truncate font-semibold text-sm">
										{item.projectTitle ?? "Untitled project"}
									</p>
									<p className="truncate text-muted-foreground text-xs">
										{template?.name ?? "Project"}
									</p>
								</div>
								<Button
									size="sm"
									onClick={() => router.push(`/projects/${item.projectId}`)}
								>
									Open project
								</Button>
							</div>
						</div>
					</div>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

const SORT_OPTIONS = [
	{ label: "Created", value: AssetSortField.CREATED_AT },
	{ label: "Kind", value: AssetSortField.KIND },
];

/**
 * /assets — paginated asset cards (dashboard card recipe): signed previews
 * in the media well, kind filter + sort in the header, "View" opens the
 * info modal (deep-linked via `?asset=` — the command palette lands here).
 */
export function AssetsView() {
	// nuqs: typed URL state, shallow replace — react-query refetches
	// client-side, the server component never re-runs on a filter change.
	const [params, setParams] = useQueryStates(assetsPageParams, {
		history: "replace",
	});
	const {
		page,
		pageSize,
		sortBy,
		sortDirection,
		kind,
		status,
		asset: selectedId,
	} = params;

	const { data, isPending, isPlaceholderData, isError, refetch } =
		useAssetsPage({
			page,
			pageSize,
			sortBy,
			sortDirection,
			kind: kind ?? undefined,
			status: status ?? undefined,
		});
	const items = data?.items ?? [];
	const showSkeletons = isPending || isPlaceholderData;

	// Deep link (?asset=): the asset may live on another page — a bounded
	// fallback fetch resolves it so palette links always open the modal.
	const selectedInPage = items.find((item) => item.id === selectedId);
	const fallbackQuery = useAssetsPage(
		{
			page: 1,
			pageSize: MAX_PAGE_SIZE,
			sortDirection: SortDirection.DESC,
		},
		Boolean(selectedId) && !selectedInPage,
	);
	const selected =
		selectedInPage ??
		fallbackQuery.data?.items.find((item) => item.id === selectedId);

	// m2 fix: a `?asset=` id that isn't on the current page AND isn't in the
	// bounded fallback fetch (deleted, or never existed) used to just leave
	// the modal silently closed — no feedback, looked like a dead link. Once
	// the fallback fetch SUCCEEDS (not merely absent/loading) with still no
	// match, tell the user and drop the stale param. Gated on `isSuccess`
	// (not just "no match yet") so a slow/failing fallback fetch — or one
	// that's simply disabled because the item resolved on-page — never fires
	// this early.
	useEffect(() => {
		if (!selectedId || selectedInPage || !fallbackQuery.isSuccess || selected) {
			return;
		}
		toast.error({
			title: "That asset no longer exists",
			description: "It may have been deleted.",
		});
		setParams({ asset: null });
	}, [
		selectedId,
		selectedInPage,
		fallbackQuery.isSuccess,
		selected,
		setParams,
	]);

	return (
		<ResourceLayout
			title="Assets"
			description="Everything your generations have produced, across all projects."
			filters={
				<ResourceFilters
					sortOptions={SORT_OPTIONS}
					sortBy={sortBy}
					onSortByChange={(next) =>
						setParams({ sortBy: next as AssetSortField, page: 1 })
					}
					sortDirection={sortDirection}
					onSortDirectionChange={(next) =>
						setParams({ sortDirection: next, page: 1 })
					}
				>
					<FilterRow label="Kind">
						<Select
							value={kind ?? "all"}
							onValueChange={(value) =>
								setParams({
									kind:
										value === "all" ? null : (value as AssetPageItem["kind"]),
									page: 1,
								})
							}
						>
							<SelectTrigger size="sm" className="w-full">
								<SelectValue placeholder="All kinds" />
							</SelectTrigger>
							<SelectContent>
								{KIND_FILTER_OPTIONS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FilterRow>
					<FilterRow label="Status">
						<Select
							value={status ?? "all"}
							onValueChange={(value) =>
								setParams({
									status: value === "all" ? null : (value as AssetStatus),
									page: 1,
								})
							}
						>
							<SelectTrigger size="sm" className="w-full">
								<SelectValue placeholder="All statuses" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All statuses</SelectItem>
								{Object.values(AssetStatus).map((value) => (
									<SelectItem key={value} value={value} className="capitalize">
										{value}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FilterRow>
				</ResourceFilters>
			}
			paginationMeta={data?.meta}
			onPageChange={(next) => setParams({ page: next })}
			onPageSizeChange={(next) => setParams({ pageSize: next, page: 1 })}
			paginationLoading={isPlaceholderData}
		>
			{showSkeletons ? (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{Array.from({ length: pageSize }, (_, index) => (
						<MediaCardSkeleton key={`skeleton-${index + 1}`} />
					))}
				</div>
			) : isError ? (
				<ErrorStateCard
					title="Couldn't load assets"
					hint="Something went wrong while fetching your assets."
					onRetry={() => refetch()}
				/>
			) : items.length > 0 ? (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{items.map((item) => (
						<MediaCard
							key={item.id}
							media={<AssetMedia item={item} />}
							icon={ASSET_KIND_ICON[item.kind] ?? ImageIcon}
							iconFrom="var(--chart-3)"
							iconTo="var(--chart-5)"
							title={kindLabel(item.kind)}
							subtitle={item.projectTitle ?? "Untitled project"}
							cta="View"
							onAction={() => setParams({ asset: item.id })}
						/>
					))}
				</div>
			) : (
				<EmptyStateCard
					icon={ImagesIcon}
					title="No assets yet"
					hint="Character sheets, keyframes and clips will appear here as your generations run."
				/>
			)}

			<AssetModal item={selected} onClose={() => setParams({ asset: null })} />
		</ResourceLayout>
	);
}
