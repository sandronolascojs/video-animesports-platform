import { MediaCardSkeleton } from "@/components/kit/media-card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shell content skeleton (Next.js `loading.tsx` for the `(shell)` group —
 * `/`, `/projects`, `/assets`, `/kit`): the `AppSidebar`/`SidebarInset` shell
 * itself is already painted by `(shell)/layout.tsx` before this ever shows —
 * this only covers the content slot, so navigation between shell routes
 * shows structure instantly instead of a frozen blank card. Reuses
 * `MediaCardSkeleton` (the same silhouette `/projects` and `/assets` already
 * show while their own query is pending) rather than inventing a new shape.
 */
export default function ShellLoading() {
	return (
		<div className="mx-auto flex h-[calc(100svh-1rem)] w-full max-w-6xl flex-col px-8 py-8">
			<div className="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex flex-col gap-2">
					<Skeleton className="h-7 w-40" />
					<Skeleton className="h-4 w-64" />
				</div>
				<Skeleton className="h-8 w-32 shrink-0" />
			</div>
			<div className="mt-6 grid flex-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{Array.from({ length: 6 }, (_, index) => (
					<MediaCardSkeleton key={index} />
				))}
			</div>
		</div>
	);
}
