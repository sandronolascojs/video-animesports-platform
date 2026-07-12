"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { ProgressiveBlur } from "@/components/ui/progressive-blur";
import { cn } from "@/libs/utils";

export type ShowMoreProps = {
	children: ReactNode;
	/** Collapsed height in px — how much content peeks under the frost. */
	peek?: number;
	/** Optional count shown in the pill: "Show more (6)". */
	moreCount?: number;
	className?: string;
};

// Apple-style spring (motion's duration+bounce form): zero bounce keeps the
// reveal crisp — this is a dashboard, not a toy — while the spring's natural
// deceleration does what no cubic-bezier over a layout property manages.
// Exits run faster than entries (emil-design-eng).
const EXPAND_SPRING = { type: "spring", duration: 0.55, bounce: 0 } as const;
const COLLAPSE_SPRING = { type: "spring", duration: 0.4, bounce: 0 } as const;

/**
 * Higgsfield-style "Show more" reveal, reusable: pass the full content and
 * the collapsed peek height — everything else is handled here. The overflow
 * peeks under a progressive frost veil (banded backdrop-blur layers, each
 * band uniform blur — dodges Chromium's mask-doesn't-attenuate-
 * backdrop-filter bug) with a glass pill floating on it; expanding is a
 * pure height reveal, never a scroll area.
 *
 * Self-disabling: content is measured (ResizeObserver), and when it fits
 * within the peek there is no veil, no pill, no height cap — a section with
 * one row renders plain.
 *
 * Animated with motion: `height: "auto"` is animated natively (motion
 * measures the target for us — no scrollHeight bookkeeping), springs stay
 * interruptible mid-reveal (a quick close during open reverses from the
 * current position instead of restarting), and AnimatePresence keeps the
 * veil mounted through its fade-out.
 */
export function ShowMore({
	children,
	peek = 176,
	moreCount,
	className,
}: ShowMoreProps) {
	const [expanded, setExpanded] = useState(false);
	const [collapsible, setCollapsible] = useState(false);
	const contentRef = useRef<HTMLDivElement>(null);
	const reduceMotion = useReducedMotion();

	useLayoutEffect(() => {
		const el = contentRef.current;
		if (!el) {
			return;
		}
		// A little slack so content barely past the peek doesn't earn a veil
		// hiding 20 leftover pixels.
		const measure = () => setCollapsible(el.scrollHeight > peek + 32);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [peek]);

	const spring = expanded ? EXPAND_SPRING : COLLAPSE_SPRING;

	return (
		<>
			<motion.div
				className={cn("relative overflow-hidden", className)}
				initial={false}
				animate={{ height: collapsible && !expanded ? peek : "auto" }}
				transition={reduceMotion ? { duration: 0 } : spring}
			>
				<div ref={contentRef}>{children}</div>

				<AnimatePresence initial={false}>
					{collapsible && !expanded ? (
						<motion.div
							key="veil"
							className="pointer-events-none absolute inset-0"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.25, ease: "easeOut" }}
						>
							{/* Whisper-light frost: a thin band hugging the pill (its
							    fade ends barely above the button), never over the
							    content itself. */}
							<ProgressiveBlur
								position="bottom"
								height="4rem"
								blurLevels={[0.5, 1, 1.5, 2, 3, 4, 5, 6]}
							/>
							{/* The frost alone isn't enough contrast for the pill —
							    a short bg fade seats it without dimming the cards. */}
							<div className="absolute inset-x-0 bottom-0 z-10 h-16 bg-[linear-gradient(to_bottom,transparent,var(--background)_95%)]" />
							<div className="absolute inset-x-0 bottom-3 z-20 flex justify-center">
								<button
									type="button"
									onClick={() => setExpanded(true)}
									className="glass-composer pointer-events-auto rounded-full px-5 py-2 font-medium text-sm transition-transform duration-150 hover:bg-white/5 active:scale-[0.97]"
								>
									Show more{moreCount ? ` (${moreCount})` : ""}
								</button>
							</div>
						</motion.div>
					) : null}
				</AnimatePresence>
			</motion.div>

			<AnimatePresence initial={false}>
				{collapsible && expanded ? (
					<motion.div
						key="show-less"
						className="flex justify-center"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.2, ease: "easeOut" }}
					>
						<button
							type="button"
							onClick={() => setExpanded(false)}
							className="rounded-full px-4 py-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground active:scale-[0.97]"
						>
							Show less
						</button>
					</motion.div>
				) : null}
			</AnimatePresence>
		</>
	);
}
