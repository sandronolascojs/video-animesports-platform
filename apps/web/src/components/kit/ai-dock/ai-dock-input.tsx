"use client";

import type { ChatStatus } from "ai";
import { BorderBeam } from "border-beam";
import { MinusIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import {
	PromptInput,
	PromptInputSubmit,
	PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { actionButtonVariants } from "@/components/kit/action-button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/libs/utils";

const PLACEHOLDER_INTERVAL_MS = 4000;
const PLACEHOLDER_TRANSITION = {
	duration: 0.24,
	ease: [0.23, 1, 0.32, 1] as const,
};
const GHOST_TRANSITION = { duration: 0.15, ease: "easeOut" as const };

export type AIDockInputMode = "hero" | "floating";

export type AIDockInputProps = {
	mode: AIDockInputMode;
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	placeholders: string[];
	leftToolbar?: ReactNode;
	status?: ChatStatus;
	/** Aborts the in-flight stream — forwarded to `PromptInputSubmit`'s `onStop`, which is what actually swaps the submit button into a working Stop control while `status` is "submitted"/"streaming". Omit to leave Stop inert (e.g. call sites with no `useChat` session). */
	onStop?: () => void;
	onMinimize?: () => void;
	className?: string;
	/**
	 * Takes priority over the rotating `placeholders` while set (Home's
	 * template-card hover-fill: shows the hovered template's example prompt
	 * as ghost text, muted, 150ms ease-out fade — distinct from the
	 * rotating placeholder's 240ms blur/y crossfade). Only ever rendered
	 * while the input is empty, same as the rotating placeholder. This is a
	 * Home-only addition on top of the reference AIInputBar, which has no
	 * ghost-text concept.
	 */
	ghostText?: string;
	/**
	 * Bump this (e.g. an incrementing counter) to imperatively focus the
	 * textarea — used by Home's "click commits + focuses" template card
	 * interaction. Kept as a value prop rather than an exposed ref so
	 * AIDockInput's public API stays fully declarative.
	 */
	focusSignal?: number;
};

/**
 * The AIDock expanded input bar — reference AIInputBar structure,
 * verbatim classes/motion, adapted to a PLAIN textarea (the reference's
 * `@`-mention/tiptap branch doesn't exist in this repo and is omitted
 * entirely — always AI Elements' default `PromptInputTextarea`, single code
 * path). Provider/reasoning selectors, fullscreen, and the sheet toggle are
 * out of scope per docs/studio-ui.md ("Out of scope (ignore from the
 * reference): the right-side Sheet, the chat panel, fullscreen, mentions,
 * provider/reasoning selectors"). `leftToolbar` renders in the BOTTOM row
 * (docs: "Bottom row: left slot for future controls, right submit"), not
 * the reference's top row — a deliberate placement deviation to match this
 * repo's own spec.
 *
 * BorderBeam is always mounted but gated to `active={isFocused}` (the
 * package's own play/pause API) so the beam only runs while the composer
 * has focus. Theme is driven by next-themes' `resolvedTheme` rather than
 * BorderBeam's own `theme="auto"`: the app is dark-only (`forcedTheme="dark"`
 * in components/providers.tsx), so `resolvedTheme` always resolves `"dark"`
 * here too — reading it keeps this component correct if that ever changes,
 * without hardcoding a duplicate "dark" literal. BorderBeam's "auto" resolves
 * purely from `window.matchMedia("prefers-color-scheme")` (OS-level) and has
 * no next-themes awareness (verified against the installed border-beam
 * ^1.3.0 source), so it would desync from the app's forced theme whenever
 * the OS preference differs — reading `resolvedTheme` avoids that class of
 * bug entirely rather than special-casing it.
 */
export function AIDockInput({
	value,
	onChange,
	onSubmit,
	placeholders,
	leftToolbar,
	status,
	onStop,
	onMinimize,
	className,
	ghostText,
	focusSignal,
}: AIDockInputProps) {
	const { resolvedTheme } = useTheme();
	const [isFocused, setIsFocused] = useState(false);
	const [placeholderIndex, setPlaceholderIndex] = useState(0);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	// next-themes can't know the persisted/system theme during SSR, so
	// resolvedTheme is undefined on the server and on the first client
	// render. Pin BorderBeam to "dark" until mounted so SSR output matches
	// the first client render, then correct on the next paint — otherwise
	// BorderBeam's injected <style> content diverges and React flags a
	// hydration mismatch.
	const [mounted, setMounted] = useState(false);

	const isEmpty = value.trim().length === 0;
	const submittable = !isEmpty;
	// Both call sites (`StudioDock`, `AgentChatComposer`) clear `value`
	// synchronously the moment they submit, so `submittable` is always false
	// for the entire "submitted"/"streaming" window — `disabled` below adds
	// this OR so the Stop control (`PromptInputSubmit`'s `onStop` branch)
	// stays clickable while a turn is in flight despite the now-empty input
	// (fix 4: otherwise Stop rendered but every click was swallowed by
	// `disabled`).
	const isGenerating = status === "submitted" || status === "streaming";
	const activePlaceholder =
		placeholders[placeholderIndex % placeholders.length];

	useEffect(() => {
		setMounted(true);
	}, []);

	useEffect(() => {
		if (!isEmpty || placeholders.length <= 1) {
			return;
		}
		const id = setInterval(() => {
			setPlaceholderIndex((index) => (index + 1) % placeholders.length);
		}, PLACEHOLDER_INTERVAL_MS);
		return () => clearInterval(id);
	}, [isEmpty, placeholders.length]);

	useEffect(() => {
		if (focusSignal === undefined) {
			return;
		}
		textareaRef.current?.focus();
	}, [focusSignal]);

	return (
		<BorderBeam
			active={isFocused}
			size="md"
			colorVariant="colorful"
			strength={0.7}
			theme={mounted && resolvedTheme === "light" ? "light" : "dark"}
			className="w-full"
		>
			<PromptInput
				onSubmit={(message) => {
					if (message.text.trim().length === 0) {
						return;
					}
					onSubmit();
				}}
				className={cn(
					// glass-composer (globals.css): the Higgsfield docked-composer
					// glass recipe — translucent card base, faint diagonal sheen,
					// inset top highlight, 50px backdrop blur. This is the FIXED
					// base look — surface stays constant across every state
					// (empty/typed, blurred/focused); only the BorderBeam glow
					// signals focus, so the shell never visibly "changes color"
					// while typing.
					"glass-composer relative isolate overflow-hidden rounded-2xl",
					"transition-colors duration-300 ease-out",
					// This repo's PromptInput always wraps children in shadcn's
					// InputGroup, which ships its own row layout + border/bg/ring
					// (unlike the reference's bare PromptInput). Neutralize it so
					// the shell recipe above is the only visible chrome and the
					// group itself just becomes our flex-col layout container.
					"[&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:flex-col [&_[data-slot=input-group]]:items-stretch [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:shadow-none [&_[data-slot=input-group]]:ring-0 [&_[data-slot=input-group]]:has-[[data-slot=input-group-control]:focus-visible]:border-0 [&_[data-slot=input-group]]:has-[[data-slot=input-group-control]:focus-visible]:ring-0",
					// InputGroup also ships `has-disabled:` styles (bg-input/50 +
					// opacity-50, dark:bg-input/80) that fire whenever ANY child is
					// disabled — the submit button is disabled while the input is
					// empty, so the whole shell visibly washed out on empty and
					// snapped back on the first keystroke. Neutralize them so the
					// surface color is identical with and without text.
					"[&_[data-slot=input-group]]:has-disabled:bg-transparent [&_[data-slot=input-group]]:has-disabled:opacity-100 dark:[&_[data-slot=input-group]]:has-disabled:bg-transparent",
					className,
				)}
			>
				{/*
				 * Always in flow (reference AIInputBar renders this row
				 * unconditionally too) — reserving the same h-6 slot whether or
				 * not a minimize button is mounted keeps the shell's height
				 * IDENTICAL between Home (hero, no onMinimize) and Studio
				 * (floating, onMinimize set). A conditionally-rendered row would
				 * make Home's composer shorter than the Studio dock's.
				 */}
				<div className="flex items-center justify-end gap-0.5 px-3 pt-2.5">
					{onMinimize ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									onClick={onMinimize}
									aria-label="Minimize"
									className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/40 transition-[color,background-color,transform] duration-150 ease-out hover:bg-muted/30 hover:text-muted-foreground active:scale-[0.94]"
								>
									<MinusIcon className="h-3.5 w-3.5" />
								</button>
							</TooltipTrigger>
							<TooltipContent side="top">Minimize</TooltipContent>
						</Tooltip>
					) : (
						<div aria-hidden className="h-6 w-6" />
					)}
				</div>

				{/* Input — auto-grows from one line up to three, then scrolls. */}
				<div className="relative">
					<AnimatePresence mode="wait" initial={false}>
						{isEmpty && ghostText ? (
							<motion.span
								key="ghost"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								transition={GHOST_TRANSITION}
								className="pointer-events-none absolute top-1 left-4 z-20 block truncate text-[15px] text-muted-foreground/60 leading-6"
							>
								{ghostText}
							</motion.span>
						) : isEmpty && activePlaceholder ? (
							<motion.span
								key={activePlaceholder}
								initial={{ opacity: 0, y: 6, filter: "blur(3px)" }}
								animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
								exit={{ opacity: 0, y: -6, filter: "blur(3px)" }}
								transition={PLACEHOLDER_TRANSITION}
								className={cn(
									"pointer-events-none absolute top-1 left-4 z-20 block truncate text-[15px] text-muted-foreground leading-6",
									isFocused && "text-muted-foreground/90",
								)}
							>
								{activePlaceholder}
							</motion.span>
						) : null}
					</AnimatePresence>
					<PromptInputTextarea
						ref={textareaRef}
						value={value}
						onChange={(event) => onChange(event.target.value)}
						onFocus={() => setIsFocused(true)}
						onBlur={() => setIsFocused(false)}
						placeholder=""
						className="field-sizing-content relative z-10 max-h-[84px] min-h-[28px] overflow-y-auto px-4 py-1 text-[15px] text-foreground leading-6 caret-primary focus-visible:ring-0 focus-visible:ring-offset-0"
					/>
				</div>

				{/* Bottom row — selectors left, submit right, in flow (never overlaps the input). */}
				<div className="flex items-center justify-between gap-2 px-3 pt-1 pb-3">
					<div className="flex min-w-0 items-center gap-1">{leftToolbar}</div>
					{/* Outline while empty, primary once there is text; no opacity dim. */}
					<PromptInputSubmit
						status={status}
						onStop={onStop}
						disabled={!submittable && !isGenerating}
						variant={submittable ? "default" : "outline"}
						className={actionButtonVariants({ active: submittable })}
					/>
				</div>
			</PromptInput>
		</BorderBeam>
	);
}
