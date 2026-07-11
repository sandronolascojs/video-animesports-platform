"use client";

import type { SortDirection } from "@video-platform-challenge/types";
import {
	ArrowDownWideNarrowIcon,
	ArrowUpNarrowWideIcon,
	SlidersHorizontalIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

export type SortOption = { label: string; value: string };

export type ResourceFiltersProps = {
	sortOptions: SortOption[];
	sortBy: string;
	onSortByChange: (value: string) => void;
	sortDirection: SortDirection;
	onSortDirectionChange: (value: SortDirection) => void;
	/** Resource-specific filter rows (label + control), stacked above sort. */
	children?: ReactNode;
};

/** Labeled row inside the filters popover. */
export function FilterRow({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label className="text-muted-foreground text-xs">{label}</Label>
			{children}
		</div>
	);
}

/**
 * Filters live in a Popover opening to the LEFT of its trigger (user call):
 * resource-specific rows first, sort field + direction at the bottom — one
 * consistent surface for every paginated page.
 */
export function ResourceFilters({
	sortOptions,
	sortBy,
	onSortByChange,
	sortDirection,
	onSortDirectionChange,
	children,
}: ResourceFiltersProps) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="outline" size="sm" className="gap-2">
					<SlidersHorizontalIcon />
					Filters
				</Button>
			</PopoverTrigger>
			<PopoverContent side="left" align="start" className="w-64 space-y-4">
				{children}
				<FilterRow label="Sort by">
					<div className="flex items-center gap-2">
						<Select value={sortBy} onValueChange={onSortByChange}>
							<SelectTrigger size="sm" className="flex-1">
								<SelectValue placeholder="Sort by" />
							</SelectTrigger>
							<SelectContent>
								{sortOptions.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Button
							variant="outline"
							size="icon-sm"
							aria-label={
								sortDirection === "asc" ? "Sort descending" : "Sort ascending"
							}
							onClick={() =>
								onSortDirectionChange(sortDirection === "asc" ? "desc" : "asc")
							}
						>
							{sortDirection === "asc" ? (
								<ArrowUpNarrowWideIcon />
							) : (
								<ArrowDownWideNarrowIcon />
							)}
						</Button>
					</div>
				</FilterRow>
			</PopoverContent>
		</Popover>
	);
}
