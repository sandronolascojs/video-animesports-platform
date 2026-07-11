"use client";

import {
	PAGE_SIZE_OPTIONS,
	type PaginationMeta,
} from "@video-platform-challenge/types";
import { useEffect } from "react";

import {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from "@/components/ui/pagination";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/libs/utils";

export type ListPaginationProps = {
	meta: PaginationMeta;
	onPageChange: (page: number) => void;
	onPageSizeChange?: (pageSize: number) => void;
	className?: string;
};

function pageNumbers(
	page: number,
	totalPages: number,
): (number | "ellipsis-start" | "ellipsis-end")[] {
	if (totalPages <= 7) {
		return Array.from({ length: totalPages }, (_, index) => index + 1);
	}
	const left = Math.max(page - 1, 1);
	const right = Math.min(page + 1, totalPages);
	const range: (number | "ellipsis-start" | "ellipsis-end")[] = [1];
	if (left > 2) {
		range.push("ellipsis-start");
	}
	for (let i = Math.max(left, 2); i <= Math.min(right, totalPages - 1); i++) {
		range.push(i);
	}
	if (right < totalPages - 1) {
		range.push("ellipsis-end");
	}
	range.push(totalPages);
	return range;
}

/**
 * Bottom pagination bar: range summary
 * left, page-size select + numbered pager right — shadcn Pagination/Select
 * throughout. Always visible so the page height doesn't jump between pages.
 */
export function ListPagination({
	meta,
	onPageChange,
	onPageSizeChange,
	className,
}: ListPaginationProps) {
	const { page, pageSize, total, totalPages } = meta;
	// m1 fix: `meta.page` just echoes back whatever the URL asked for
	// (`calculatePaginationMeta`, packages/types/src/pagination.ts) — a stale
	// `?page=99` left over after a filter/delete drops the result count
	// exceeds `totalPages` (which is always >= 1), and the raw range math
	// below would read "Showing 2451–5 of 5". Clamp for display so the
	// readout — and the Prev/Next/page-link states derived from it — always
	// stay sane, and hand the out-of-range page back to the caller so the
	// URL/query state corrects itself on the next render.
	const currentPage = Math.min(Math.max(page, 1), totalPages);

	useEffect(() => {
		if (page > totalPages) {
			onPageChange(totalPages);
		}
	}, [page, totalPages, onPageChange]);

	const startItem = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
	const endItem = Math.min(currentPage * pageSize, total);

	return (
		<div
			className={cn(
				"flex flex-col items-center justify-between gap-3 pt-4 sm:flex-row",
				className,
			)}
		>
			<p className="text-muted-foreground text-sm">
				{total === 0
					? "No items"
					: `Showing ${startItem}–${endItem} of ${total}`}
			</p>
			<div className="flex items-center gap-4">
				{onPageSizeChange ? (
					<Select
						value={String(pageSize)}
						onValueChange={(value) => onPageSizeChange(Number(value))}
					>
						<SelectTrigger size="sm" className="w-16">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{PAGE_SIZE_OPTIONS.map((option) => (
								<SelectItem key={option} value={String(option)}>
									{option}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : null}
				<Pagination className="mx-0 w-auto">
					<PaginationContent>
						<PaginationItem>
							<PaginationPrevious
								onClick={() => currentPage > 1 && onPageChange(currentPage - 1)}
								aria-disabled={currentPage <= 1}
								className={cn(
									"cursor-pointer",
									currentPage <= 1 && "pointer-events-none opacity-50",
								)}
							/>
						</PaginationItem>
						{pageNumbers(currentPage, totalPages).map((entry) =>
							typeof entry === "number" ? (
								<PaginationItem key={entry}>
									<PaginationLink
										isActive={entry === currentPage}
										onClick={() => onPageChange(entry)}
										className="cursor-pointer"
									>
										{entry}
									</PaginationLink>
								</PaginationItem>
							) : (
								<PaginationItem key={entry}>
									<PaginationEllipsis />
								</PaginationItem>
							),
						)}
						<PaginationItem>
							<PaginationNext
								onClick={() =>
									currentPage < totalPages && onPageChange(currentPage + 1)
								}
								aria-disabled={currentPage >= totalPages}
								className={cn(
									"cursor-pointer",
									currentPage >= totalPages && "pointer-events-none opacity-50",
								)}
							/>
						</PaginationItem>
					</PaginationContent>
				</Pagination>
			</div>
		</div>
	);
}
