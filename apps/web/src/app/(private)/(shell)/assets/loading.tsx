import { DEFAULT_PAGE_SIZE } from "@video-platform-challenge/types";
import { Loader2, SlidersHorizontalIcon } from "lucide-react";

import { MediaCardSkeleton } from "@/components/app/media-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-loading for `/assets` — SSR navigation only (client-side
 * page/filter changes are handled inside `AssetsView` itself via
 * `showSkeletons`/`paginationLoading`). Mirrors `ResourceLayout`'s exact
 * structure — same outer container, real static title/description, viewport
 * anchor — so the chrome never shifts when the real view swaps in; only the
 * items region and the pagination bar are in a loading state.
 */
export default function AssetsLoading() {
	return (
		<div className="mx-auto flex h-[calc(100svh-1rem)] w-full max-w-6xl flex-col px-8 py-8">
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 rounded-2xl border border-sidebar-border"
			/>
			<div className="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0">
					<h1 className="font-bold text-2xl tracking-tight">Assets</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						Everything your generations have produced, across all projects.
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<Button variant="outline" size="sm" className="gap-2" disabled>
						<SlidersHorizontalIcon />
						Filters
					</Button>
				</div>
			</div>

			{/* The ONLY scroll region on the page — matches ResourceLayout. */}
			<div className="no-scrollbar mt-6 flex-1 overflow-y-auto pb-4">
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{Array.from({ length: DEFAULT_PAGE_SIZE }, (_, index) => (
						<MediaCardSkeleton key={index} />
					))}
				</div>
			</div>

			{/* Pagination bar loading state — same layout as ListPagination
			    (`isLoading`), just without a real meta to render numbers from yet. */}
			<div className="flex shrink-0 flex-col items-center justify-between gap-3 border-border/60 border-t pt-4 sm:flex-row">
				<p className="flex items-center gap-2 text-muted-foreground text-sm">
					<Loader2 className="size-3.5 shrink-0 motion-safe:animate-spin" />
					Loading…
				</p>
				<div className="flex items-center gap-4 opacity-60">
					<Skeleton className="h-7 w-16" />
					<div className="flex items-center gap-0.5">
						<Skeleton className="h-8 w-20" />
						<Skeleton className="size-8 rounded-md" />
						<Skeleton className="size-8 rounded-md" />
						<Skeleton className="size-8 rounded-md" />
						<Skeleton className="h-8 w-14" />
					</div>
				</div>
			</div>
		</div>
	);
}
