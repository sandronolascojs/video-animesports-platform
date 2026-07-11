import type { ElementType, ReactNode } from "react";
import { JewelIcon } from "@/components/kit/jewel-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/libs/utils";

export type MediaCardProps = {
	/** Media area content (video/image/fallback) — rendered in a 16:9 well. */
	media: ReactNode;
	icon: ElementType;
	iconFrom?: string;
	iconTo?: string;
	title: string;
	subtitle: string;
	/** CTA pill label — "Open" for projects, "View" for assets (user call). */
	cta: string;
	onAction: () => void;
	className?: string;
};

/**
 * The dashboard card recipe (glass edge, 16:9 media well, jewel + names +
 * CTA pill footer) as a shared shell — the /projects and /assets pages feed
 * it their own media (looping preview video, signed image, fallback art).
 */
export function MediaCard({
	media,
	icon,
	iconFrom,
	iconTo,
	title,
	subtitle,
	cta,
	onAction,
	className,
}: MediaCardProps) {
	return (
		<div
			className={cn(
				"glass-edge flex flex-col gap-3 rounded-2xl bg-card/50 p-3",
				className,
			)}
		>
			<div className="relative aspect-video overflow-hidden rounded-xl bg-card/80">
				{media}
				<div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.35),transparent_40%)]" />
			</div>
			<div className="flex items-center gap-3">
				<JewelIcon icon={icon} from={iconFrom} to={iconTo} size={34} />
				<div className="min-w-0 flex-1">
					<p className="truncate font-semibold text-sm">{title}</p>
					<p className="truncate text-muted-foreground text-xs">{subtitle}</p>
				</div>
				<button
					type="button"
					onClick={onAction}
					className="shrink-0 rounded-full bg-primary px-4 py-1.5 font-medium text-primary-foreground text-sm transition-transform duration-150 hover:bg-primary/90 active:scale-[0.97]"
				>
					{cta}
				</button>
			</div>
		</div>
	);
}

/** Loading silhouette of MediaCard — same box, same rhythm. */
export function MediaCardSkeleton() {
	return (
		<div className="glass-edge flex flex-col gap-3 rounded-2xl bg-card/50 p-3">
			<Skeleton className="aspect-video w-full rounded-xl" />
			<div className="flex items-center gap-3">
				<Skeleton className="size-[34px] shrink-0 rounded-xl" />
				<div className="min-w-0 flex-1 space-y-1.5">
					<Skeleton className="h-3.5 w-2/5" />
					<Skeleton className="h-3 w-3/5" />
				</div>
				<Skeleton className="h-8 w-16 shrink-0 rounded-full" />
			</div>
		</div>
	);
}
