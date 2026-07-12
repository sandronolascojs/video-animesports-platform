"use client";

import type { PaginationMeta } from "@video-platform-challenge/types";
import type { ReactNode } from "react";

import { ListPagination } from "@/components/kit/list-pagination";
import { cn } from "@/libs/utils";

export type ResourceLayoutProps = {
	title: string;
	description?: string;
	/** Filters trigger (popover) — sits right of the header. */
	filters?: ReactNode;
	children: ReactNode;
	paginationMeta?: PaginationMeta;
	onPageChange?: (page: number) => void;
	onPageSizeChange?: (pageSize: number) => void;
	className?: string;
	/** Forwarded to `ListPagination`'s `isLoading` — a client-side page/filter
	 * refetch in flight, distinct from the initial-load card skeletons. */
	paginationLoading?: boolean;
};

/**
 * Resource-page shell, viewport-anchored: the page
 * itself NEVER scrolls — header and the bottom pagination bar are pinned,
 * only the items region scrolls (`flex-1 overflow-y-auto`). The height
 * anchor matches the private shell's content card (100svh minus its my-2).
 */
export function ResourceLayout({
	title,
	description,
	filters,
	children,
	paginationMeta,
	onPageChange,
	onPageSizeChange,
	className,
	paginationLoading,
}: ResourceLayoutProps) {
	return (
		<div
			className={cn(
				"mx-auto flex h-[calc(100svh-1rem)] w-full max-w-6xl flex-col px-8 py-8",
				className,
			)}
		>
			{/* Content-card ring: anchors to the shell's SidebarInset (its nearest
			    positioned ancestor), mirroring the sidebar card's border. The
			    dashboard draws its own fading ring inside the hero scroller, so
			    this lives here — resource pages only. */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 rounded-2xl border border-sidebar-border"
			/>
			<div className="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0">
					<h1 className="font-bold text-2xl tracking-tight">{title}</h1>
					{description ? (
						<p className="mt-1 text-muted-foreground text-sm">{description}</p>
					) : null}
				</div>
				{filters ? (
					<div className="flex shrink-0 items-center gap-2">{filters}</div>
				) : null}
			</div>

			{/* The ONLY scroll region on the page. */}
			<div className="no-scrollbar mt-6 flex-1 overflow-y-auto pb-4">
				{children}
			</div>

			{paginationMeta && onPageChange ? (
				<ListPagination
					className="shrink-0 border-border/60 border-t"
					meta={paginationMeta}
					onPageChange={onPageChange}
					onPageSizeChange={onPageSizeChange}
					isLoading={paginationLoading}
				/>
			) : null}
		</div>
	);
}
