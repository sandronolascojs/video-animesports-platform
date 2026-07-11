"use client";

import { AnimatePresence, type MotionProps, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/libs/utils/index";

interface WordRotateProps {
	words: string[];
	duration?: number;
	motionProps?: MotionProps;
	className?: string;
}

/**
 * magicui word-rotate, restyled twice over:
 * - renders SPANS instead of the upstream div/h1 pair — the rotating word
 *   composes INSIDE a heading here (the hero CTA lockup), and headings only
 *   permit phrasing content;
 * - the container WIDTH spring-animates to each word's measured width (an
 *   invisible absolute twin does the measuring). Without this the line
 *   re-centers in a single frame on every swap and the static text around
 *   the component visibly jumps.
 */
export function WordRotate({
	words,
	duration = 2500,
	// Upstream default travels ±50px — half the word floats outside a
	// heading's line box and the swap reads as a jump. A ±16px slide with a
	// light blur crossfade reads as one word morphing into the next.
	motionProps = {
		initial: { opacity: 0, y: -16, filter: "blur(4px)" },
		animate: { opacity: 1, y: 0, filter: "blur(0px)" },
		exit: { opacity: 0, y: 16, filter: "blur(4px)" },
		transition: { duration: 0.22, ease: "easeOut" },
	},
	className,
}: WordRotateProps) {
	const [index, setIndex] = useState(0);
	const [width, setWidth] = useState<number | undefined>(undefined);
	const measureRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		const interval = setInterval(() => {
			setIndex((prevIndex) => (prevIndex + 1) % words.length);
		}, duration);

		return () => clearInterval(interval);
	}, [words, duration]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `index` isn't read in the effect body, but each word swap is exactly when the twin's width must be re-measured.
	useLayoutEffect(() => {
		const el = measureRef.current;
		if (el) {
			setWidth(el.offsetWidth);
		}
	}, [index]);

	return (
		<span className="relative inline-block align-bottom">
			{/* Invisible twin of the current word — the width source. */}
			<span
				ref={measureRef}
				aria-hidden
				className={cn(
					"invisible absolute top-0 left-0 whitespace-pre",
					className,
				)}
			>
				{words[index]}
			</span>
			<motion.span
				className="inline-block overflow-hidden whitespace-pre align-bottom"
				animate={width !== undefined ? { width } : undefined}
				transition={{ type: "spring", duration: 0.35, bounce: 0 }}
			>
				<AnimatePresence mode="wait">
					<motion.span
						key={words[index]}
						className={cn("inline-block", className)}
						{...motionProps}
					>
						{words[index]}
					</motion.span>
				</AnimatePresence>
			</motion.span>
		</span>
	);
}
