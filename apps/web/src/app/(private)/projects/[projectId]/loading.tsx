import { Skeleton } from "@/components/ui/skeleton";

/**
 * Studio loading skeleton (Next.js `loading.tsx` for
 * `projects/[projectId]/`): `page.tsx` `await`s a full `projects.get` SSR
 * fetch before it can render `StudioView`/`StudioNotFound` (see that file's
 * doc comment), which otherwise froze the whole route on a blank screen
 * until the fetch settled. Mirrors `StudioView`'s exact topbar + 3-column
 * panel + timeline grid (`feature/studio/views/studio-view.tsx`,
 * `surface-panel` classes from `studio-topbar.tsx`/`left-panel.tsx`/
 * `player-canvas.tsx`/`history-panel.tsx`/`timeline-strip.tsx`) so structure
 * appears instantly instead of a freeze.
 */
export default function StudioLoading() {
	return (
		<div className="flex h-svh min-h-0 flex-col gap-3 p-3">
			{/* Topbar */}
			<div className="surface-panel flex items-center gap-3 px-3 py-2.5">
				<Skeleton className="size-8 shrink-0 rounded-lg" />
				<Skeleton className="h-4 max-w-48 flex-1" />
				<Skeleton className="h-5 w-16 shrink-0 rounded-full" />
				<Skeleton className="h-7 w-20 shrink-0 rounded-lg" />
			</div>

			{/* Left panel / Player / History */}
			<div className="grid min-h-0 flex-1 grid-cols-[20rem_1fr_18rem] gap-3">
				<div className="surface-panel flex h-full min-h-0 flex-col gap-3 p-3">
					<Skeleton className="h-8 w-full rounded-lg" />
					<Skeleton className="h-20 w-full rounded-lg" />
					<Skeleton className="h-20 w-full rounded-lg" />
					<Skeleton className="h-20 w-full rounded-lg" />
				</div>
				<div className="surface-panel flex h-full min-h-0 items-center justify-center bg-black/60 p-4">
					<Skeleton className="size-16 rounded-full bg-white/10" />
				</div>
				<div className="surface-panel flex h-full min-h-0 flex-col gap-3 p-3">
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-16 w-full rounded-lg" />
					<Skeleton className="h-16 w-full rounded-lg" />
				</div>
			</div>

			{/* Timeline */}
			<div className="h-52 shrink-0">
				<div className="surface-panel flex h-full flex-col gap-2 p-3">
					<Skeleton className="h-4 w-32" />
					<Skeleton className="w-full flex-1 rounded-lg" />
				</div>
			</div>
		</div>
	);
}
