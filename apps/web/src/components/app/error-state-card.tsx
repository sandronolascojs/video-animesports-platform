import { AlertTriangleIcon, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Error counterpart to `EmptyStateCard`
 * (feature/home/components/dashboard-sections.tsx) — same card recipe
 * (dashed border, icon, title, hint) so a failed fetch and a genuinely empty
 * list never look identical. `onRetry` is optional: pass a query's own
 * `refetch` to offer a retry action, omit it for read-only surfaces.
 */
export function ErrorStateCard({
	icon: Icon = AlertTriangleIcon,
	title = "Something went wrong",
	hint = "We couldn't load this. Please try again.",
	onRetry,
}: {
	icon?: LucideIcon;
	title?: string;
	hint?: string;
	onRetry?: () => void;
}) {
	return (
		<div className="flex flex-col items-center gap-3 rounded-2xl border border-destructive/30 border-dashed px-6 py-14 text-center">
			<Icon className="size-6 text-destructive/70" />
			<div>
				<p className="font-medium text-sm">{title}</p>
				<p className="mt-1 text-muted-foreground text-sm">{hint}</p>
			</div>
			{onRetry ? (
				<Button variant="outline" size="sm" onClick={onRetry}>
					Retry
				</Button>
			) : null}
		</div>
	);
}
