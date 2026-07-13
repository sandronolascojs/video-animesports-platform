"use client";

import { CheckIcon, CommandIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

import { Spinner } from "@/components/ui/spinner";

const PLACEHOLDER_INTERVAL_MS = 4000;
const CROSSFADE_TRANSITION = {
	duration: 0.24,
	ease: [0.23, 1, 0.32, 1] as const,
};

export type AIDockPillProps = {
	taskName: string | null;
	isWorking: boolean;
	hasMessages: boolean;
	onOpen: () => void;
	placeholders: string[];
	showKeyboardHint?: boolean;
};

/**
 * Collapsed AIDock state — full-width pill (reference AIDock, verbatim
 * structure/classes/motion). Shows the rotating placeholder while idle, or
 * `taskName · Working`/`Complete` once a task has run — gated on BOTH
 * `hasMessages` and `taskName` per the reference (`showStatus = hasMessages
 * && taskName`), not on `taskName` truthiness alone. Right side: kbd hint
 * (reference shows ⌘ L; ours is ⌘ J — ⌘K opens the command palette).
 */
export function AIDockPill({
	taskName,
	isWorking,
	hasMessages,
	onOpen,
	placeholders,
	showKeyboardHint = true,
}: AIDockPillProps) {
	const [placeholderIndex, setPlaceholderIndex] = useState(0);
	const showStatus = hasMessages && Boolean(taskName);

	useEffect(() => {
		if (showStatus || placeholders.length <= 1) {
			return;
		}
		const id = setInterval(() => {
			setPlaceholderIndex((index) => (index + 1) % placeholders.length);
		}, PLACEHOLDER_INTERVAL_MS);
		return () => clearInterval(id);
	}, [showStatus, placeholders.length]);

	const currentPlaceholder = placeholders[placeholderIndex] ?? placeholders[0];

	return (
		<button
			onClick={onOpen}
			className="glass-composer group flex w-full items-center justify-between rounded-2xl px-4 py-3 transition-[border-color,box-shadow] duration-300 ease-out hover:shadow-lg"
			type="button"
		>
			<div className="flex min-w-0 items-center gap-2 text-sm">
				{showStatus ? (
					<>
						<span className="max-w-[220px] truncate text-muted-foreground">
							{taskName}
						</span>
						<span className="shrink-0 text-muted-foreground/50">·</span>
						{isWorking ? (
							<span className="flex shrink-0 items-center gap-1 text-muted-foreground">
								<Spinner className="size-3" />
								<span className="text-xs">Working</span>
							</span>
						) : (
							<span className="flex shrink-0 items-center gap-1 text-emerald-500">
								<CheckIcon className="size-3" />
								<span className="text-xs">Complete</span>
							</span>
						)}
					</>
				) : (
					<div className="relative h-5 overflow-hidden">
						<AnimatePresence mode="wait" initial={false}>
							<motion.span
								key={currentPlaceholder}
								initial={{ opacity: 0, y: 8, filter: "blur(2px)" }}
								animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
								exit={{ opacity: 0, y: -8, filter: "blur(2px)" }}
								transition={CROSSFADE_TRANSITION}
								className="whitespace-nowrap text-muted-foreground/50 transition-colors duration-200 group-hover:text-muted-foreground/70"
							>
								{currentPlaceholder}
							</motion.span>
						</AnimatePresence>
					</div>
				)}
			</div>

			{showKeyboardHint && (
				<div className="flex shrink-0 items-center gap-1 text-muted-foreground/40 transition-colors duration-200 group-hover:text-muted-foreground/60">
					<kbd className="inline-flex items-center gap-0.5 rounded border border-border/60 bg-muted/30 px-1 py-0.5 font-medium text-[10px]">
						<CommandIcon className="h-2.5 w-2.5" />
					</kbd>
					<span className="text-[10px]">+</span>
					<kbd className="inline-flex items-center rounded border border-border/60 bg-muted/30 px-1 py-0.5 font-medium text-[10px]">
						J
					</kbd>
				</div>
			)}
		</button>
	);
}
