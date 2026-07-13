"use client";

import type { ChatStatus } from "ai";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { AIDockInput } from "@/components/app/ai-dock/ai-dock-input";
import { AIDockPill } from "@/components/app/ai-dock/ai-dock-pill";
import { AIDockStatusBar } from "@/components/app/ai-dock/ai-dock-status-bar";
import { useShortcut } from "@/hooks/use-platform";

export type AIDockProps = {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	placeholders: string[];
	leftToolbar?: ReactNode;
	taskName?: string;
	isWorking?: boolean;
	/** Whether any task/message has ever run this session — gates the status bar (AIDockStatusBar doc comment: "Visible ONLY when collapsed + hasMessages"). */
	hasMessages?: boolean;
	status?: ChatStatus;
	/** Forwarded to `AIDockInput`'s own `onStop` — see that prop's doc comment. */
	onStop?: () => void;
	/**
	 * Bump this (e.g. an incrementing counter) to imperatively expand the dock
	 * from its collapsed pill state — used by the global AI dock's "New
	 * project" affordance (docs scenes-architecture-v3.md A6) to open the dock
	 * from anywhere on the page. `undefined` (the default) never expands it.
	 */
	openSignal?: number;
	/** Forwarded to `AIDockInput`'s own `focusSignal` (only meaningful once
	 * the dock is expanded and `AIDockInput` is mounted) — see that prop's
	 * doc comment. */
	focusSignal?: number;
	/**
	 * Studio-only (docs/ai-architecture-v1.md §2 "A toggle affordance opens
	 * the sidebar from the dock"): forwarded to `AIDockInput`'s own
	 * `onOpenSidebar` (Studio UI polish — moved off a standalone button beside
	 * the dock and into the expanded input's top-right control row, next to
	 * Minimize), so it only ever renders while the dock is expanded.
	 * `undefined` (the default) hides it entirely, so `AIDock` stays usable
	 * standalone (e.g. the kit preview page) without this Studio-specific
	 * affordance.
	 */
	onOpenSidebar?: () => void;
};

const CROSSFADE_TRANSITION = { duration: 0.2, ease: "easeOut" as const };
const MOUNT_TRANSITION = { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const };
const LAYOUT_TRANSITION = { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const };

/**
 * The floating AIDock — Studio-only (the docs' "Dock placement" rule:
 * the pill/status-bar/minimize behavior exists only in the Studio; Home
 * renders `AIDockInput` directly in "hero" mode, always expanded, no dock
 * chrome). Transport-agnostic: no chat, no sheet, no useChat here (v3 wires
 * those on top of onSubmit/value/onChange).
 *
 * ⌘J toggles the dock open/closed from anywhere on the page — the pill and
 * status bar both surface the same kbd hint as the affordance for this.
 */
export function AIDock({
	value,
	onChange,
	onSubmit,
	placeholders,
	leftToolbar,
	taskName,
	isWorking = false,
	hasMessages = false,
	status,
	onStop,
	openSignal,
	focusSignal,
	onOpenSidebar,
}: AIDockProps) {
	const [expanded, setExpanded] = useState(false);

	// "j" — ⌘K belongs to the global command palette (industry standard);
	// the dock hints below and in ai-dock-pill/ai-dock-status-bar say ⌘J to
	// match.
	useShortcut("j", () => setExpanded((prev) => !prev));

	// Imperative expand (docs scenes-architecture-v3.md A6) — `openSignal`
	// stays `undefined` until a caller bumps it, so this never force-expands
	// the dock on mount (same sentinel convention as AIDockInput's own
	// `focusSignal` prop).
	useEffect(() => {
		if (openSignal === undefined) {
			return;
		}
		setExpanded(true);
	}, [openSignal]);

	return (
		<motion.div
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			// Mirrors `initial` — when a parent `AnimatePresence` unmounts `AIDock`
			// (Studio hides the dock the instant `AgentChatSidebar` opens, docs
			// "never both visible"), it fades/drops the SAME 8px instead of
			// popping out instantly. Same `MOUNT_TRANSITION` duration/easing on
			// both sides so the dock's exit and the sidebar's entrance
			// (`agent-chat-sidebar.tsx`'s own `MOUNT_TRANSITION`) read as one
			// cohesive handoff, not two unrelated animations.
			exit={{ opacity: 0, y: 8 }}
			transition={MOUNT_TRANSITION}
			// `absolute`, not `fixed`: the dock centers within its nearest positioned
			// ancestor — the CONTENT area (Studio root / Home's relative wrapper) —
			// so it stays symmetric with the in-page composer instead of centering
			// on the full viewport (which is offset by the sidebar).
			className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex flex-col items-center px-4 pb-4"
		>
			<div className="pointer-events-auto w-full max-w-2xl">
				<AnimatePresence initial={false}>
					{!expanded && hasMessages ? (
						<AIDockStatusBar
							key="status"
							taskName={taskName ?? null}
							isWorking={isWorking}
							onExpand={() => setExpanded(true)}
						/>
					) : null}
				</AnimatePresence>

				<motion.div layout transition={LAYOUT_TRANSITION}>
					<AnimatePresence mode="wait" initial={false}>
						{expanded ? (
							<motion.div
								key="input"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								transition={CROSSFADE_TRANSITION}
							>
								<AIDockInput
									mode="floating"
									value={value}
									onChange={onChange}
									onSubmit={onSubmit}
									placeholders={placeholders}
									leftToolbar={leftToolbar}
									status={status}
									onStop={onStop}
									onMinimize={() => setExpanded(false)}
									onOpenSidebar={onOpenSidebar}
									focusSignal={focusSignal}
								/>
							</motion.div>
						) : (
							<motion.div
								key="pill"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								transition={CROSSFADE_TRANSITION}
							>
								<AIDockPill
									placeholders={placeholders}
									taskName={taskName ?? null}
									isWorking={isWorking}
									hasMessages={hasMessages}
									onOpen={() => setExpanded(true)}
								/>
							</motion.div>
						)}
					</AnimatePresence>
				</motion.div>
			</div>
		</motion.div>
	);
}
