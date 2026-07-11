"use client";

import { ArrowUpRightIcon, CheckIcon, CommandIcon } from "lucide-react";
import { motion } from "motion/react";

import { Spinner } from "@/components/ui/spinner";

export type AIDockStatusBarLabels = {
	working: string;
	complete: string;
	openChat: string;
};

const DEFAULT_LABELS: AIDockStatusBarLabels = {
	working: "Working",
	complete: "Complete",
	openChat: "Open chat",
};

export type AIDockStatusBarProps = {
	taskName: string | null;
	isWorking: boolean;
	onExpand: () => void;
	labels?: AIDockStatusBarLabels;
};

/**
 * Slides above the AIDock input while collapsed with an active/last
 * task (reference AIStatusBar, verbatim content/classes — labels prop, ⌘K
 * hint, emerald-500 "Complete" state). Visible ONLY when collapsed +
 * hasMessages — that gate lives in the parent `AIDock`, matching the
 * reference doc-comment ("Visible ONLY when collapsed + hasMessages").
 *
 * The mount/unmount height-lock choreography (240ms
 * cubic-bezier(0.16,1,0.3,1), height 0→36) is NOT in the reference file —
 * there it's owned by the parent `AIPanel`, which is out of scope here — so
 * it's sourced from docs/studio-ui.md's "Status bar" spec instead and kept
 * self-contained in this component.
 */
export function AIDockStatusBar({
	taskName,
	isWorking,
	onExpand,
	labels = DEFAULT_LABELS,
}: AIDockStatusBarProps) {
	return (
		<motion.div
			layout
			initial={{ height: 0, opacity: 0 }}
			animate={{ height: 36, opacity: 1 }}
			exit={{ height: 0, opacity: 0 }}
			transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
			className="mx-auto w-[95%] overflow-hidden"
		>
			<div className="flex h-full items-center justify-between rounded-t-lg border border-border border-b-0 bg-card px-3">
				<div className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
					{taskName && (
						<span className="max-w-[180px] truncate">{taskName}</span>
					)}
					{taskName && <span className="shrink-0">·</span>}
					{isWorking ? (
						<span className="flex shrink-0 items-center gap-1">
							<Spinner className="size-3" />
							{labels.working}
						</span>
					) : (
						<span className="flex shrink-0 items-center gap-1 text-emerald-500">
							<CheckIcon className="size-3" />
							{labels.complete}
						</span>
					)}
				</div>

				<button
					type="button"
					onClick={onExpand}
					className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs transition-colors duration-150 hover:text-foreground"
				>
					{labels.openChat}
					<kbd className="inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1 py-0.5 font-medium text-[10px]">
						<CommandIcon className="h-2.5 w-2.5" />
					</kbd>
					<span className="text-[10px]">+</span>
					<kbd className="inline-flex items-center rounded border border-border bg-muted px-1 py-0.5 font-medium text-[10px]">
						J
					</kbd>
					<ArrowUpRightIcon className="h-3 w-3" />
				</button>
			</div>
		</motion.div>
	);
}
