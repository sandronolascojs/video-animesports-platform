"use client";

import type { ProjectPageItem } from "@video-platform-challenge/api";
import {
	ProjectSortField,
	ProjectStatus,
} from "@video-platform-challenge/types";
import { ClapperboardIcon, FolderIcon } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useQueryStates } from "nuqs";
import { ErrorStateCard } from "@/components/app/error-state-card";
import { FrostedImage, FrostedVideo } from "@/components/app/frosted-media";
import { MediaCard, MediaCardSkeleton } from "@/components/app/media-card";
import { FilterRow, ResourceFilters } from "@/components/app/resource-filters";
import { ResourceLayout } from "@/components/app/resource-layout";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
// Cross-feature imports (home owns the empty-state card + template config;
// studio owns signed asset URLs).
import { EmptyStateCard } from "@/feature/home/components/dashboard-sections";
import { SPORT_TEMPLATES } from "@/feature/home/sport-templates";
import { useProjectsPage } from "@/feature/projects/hooks/http/use-projects-page";
import { projectsPageParams } from "@/libs/pagination/search-params";

/**
 * The project's own preview: its first ready scene video (looping), or — while
 * it's still generating — its first keyframe still. Only a project that has
 * produced NOTHING falls back to the generic template art. Frosted well: 9:16
 * content renders contained over its own blurred cover copy, so the card stays
 * 16:9 everywhere.
 */
function ProjectPreview({ item }: { item: ProjectPageItem }) {
	const template = SPORT_TEMPLATES.find(
		(candidate) => candidate.key === item.templateKey,
	);

	// The project owns a preview asset — show it via the server-minted signed
	// URL bundled on the page item, never the generic template still.
	if (item.previewUrl) {
		const isVideo =
			item.previewKind === "scene_video" || item.previewKind === "render";
		return isVideo ? (
			<FrostedVideo src={item.previewUrl} />
		) : (
			<FrostedImage src={item.previewUrl} alt="" />
		);
	}

	// Nothing generated yet — template art, or a gradient for template-less keys.
	return template?.hasStill ? (
		<Image
			src={`/templates/${template.key}-v2.png`}
			alt=""
			fill
			sizes="480px"
			className="object-cover"
		/>
	) : (
		<div className="absolute inset-0 bg-gradient-to-br from-chart-1 to-chart-2" />
	);
}

const SORT_OPTIONS = [
	{ label: "Created", value: ProjectSortField.CREATED_AT },
	{ label: "Title", value: ProjectSortField.TITLE },
];

/**
 * /projects — paginated project cards (dashboard card recipe): the media
 * well loops the project's FIRST ready scene video over the template still,
 * footer carries the template jewel + names, "Open" goes to the Studio.
 * Layout/filters/pagination follow the shared ResourceLayout contract.
 */
export function ProjectsView() {
	const router = useRouter();
	// nuqs: typed URL state, shallow replace — react-query refetches
	// client-side, the server component never re-runs on a page flip.
	const [pagination, setPagination] = useQueryStates(projectsPageParams, {
		history: "replace",
	});
	const { status, template, ...pageQuery } = pagination;
	const { data, isPending, isPlaceholderData, isError, refetch } =
		useProjectsPage({
			...pageQuery,
			status: status ?? undefined,
			templateKey: template ?? undefined,
		});

	const items = data?.items ?? [];
	const showSkeletons = isPending || isPlaceholderData;

	return (
		<ResourceLayout
			title="Projects"
			description="Every episode you've started — open one to keep directing."
			filters={
				<ResourceFilters
					sortOptions={SORT_OPTIONS}
					sortBy={pagination.sortBy}
					onSortByChange={(next) =>
						setPagination({ sortBy: next as ProjectSortField, page: 1 })
					}
					sortDirection={pagination.sortDirection}
					onSortDirectionChange={(next) =>
						setPagination({ sortDirection: next, page: 1 })
					}
				>
					<FilterRow label="Status">
						<Select
							value={status ?? "all"}
							onValueChange={(value) =>
								setPagination({
									status: value === "all" ? null : (value as ProjectStatus),
									page: 1,
								})
							}
						>
							<SelectTrigger size="sm" className="w-full">
								<SelectValue placeholder="All statuses" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All statuses</SelectItem>
								{Object.values(ProjectStatus).map((value) => (
									<SelectItem key={value} value={value} className="capitalize">
										{value}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FilterRow>
					<FilterRow label="Template">
						<Select
							value={template ?? "all"}
							onValueChange={(value) =>
								setPagination({
									template:
										value === "all"
											? null
											: (value as (typeof SPORT_TEMPLATES)[number]["key"]),
									page: 1,
								})
							}
						>
							<SelectTrigger size="sm" className="w-full">
								<SelectValue placeholder="All templates" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All templates</SelectItem>
								{SPORT_TEMPLATES.map((candidate) => (
									<SelectItem key={candidate.key} value={candidate.key}>
										{candidate.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FilterRow>
				</ResourceFilters>
			}
			paginationMeta={data?.meta}
			onPageChange={(page) => setPagination({ page })}
			onPageSizeChange={(pageSize) => setPagination({ pageSize, page: 1 })}
			paginationLoading={isPlaceholderData}
		>
			{showSkeletons ? (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{Array.from({ length: pagination.pageSize }, (_, index) => (
						<MediaCardSkeleton key={index} />
					))}
				</div>
			) : isError ? (
				<ErrorStateCard
					title="Couldn't load projects"
					hint="Something went wrong while fetching your projects."
					onRetry={() => refetch()}
				/>
			) : items.length > 0 ? (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{items.map((item) => {
						const template = SPORT_TEMPLATES.find(
							(candidate) => candidate.key === item.templateKey,
						);
						return (
							<MediaCard
								key={item.id}
								media={<ProjectPreview item={item} />}
								icon={template?.icon ?? ClapperboardIcon}
								iconFrom={template?.gradient.from}
								iconTo={template?.gradient.to}
								title={item.title ?? "Untitled project"}
								subtitle={template?.name ?? "Project"}
								cta="Open"
								onAction={() => router.push(`/projects/${item.id}`)}
							/>
						);
					})}
				</div>
			) : (
				<EmptyStateCard
					icon={FolderIcon}
					title="No projects yet"
					hint="Head to the dashboard and describe your first episode."
				/>
			)}
		</ResourceLayout>
	);
}
