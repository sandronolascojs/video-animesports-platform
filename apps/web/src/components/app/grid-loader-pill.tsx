"use client";

import type { ReactNode } from "react";

import {
	GridLoader,
	type GridMatrix,
	type PresetPattern,
} from "@/components/ui/grid-loader";
import { cn } from "@/libs/utils";

/** Default multicolor palette — sky, amber, green, pink, violet. Each cell
 *  cycles the next color by grid position, so the mark reads multicolor. */
const MULTICOLOR = ["#38bdf8", "#fbbf24", "#4ade80", "#f472b6", "#a78bfa"];

export type GridLoaderPillProps = {
	label: ReactNode;
	/** A single color preset/CSS color, or an array for a multicolor mark. */
	color?: string | string[];
	mode?: "pulse" | "sequence" | "stagger";
	/** Single pattern (pulse/stagger). Ignored when `sequence` drives the mark. */
	pattern?: PresetPattern | GridMatrix;
	/** Pattern cycle for `mode="sequence"`. */
	sequence?: Array<PresetPattern | GridMatrix>;
	className?: string;
};

/**
 * The app's single loading affordance for in-flight agent/generation work: a
 * small `GridLoader` mark + a label on a black rounded-full chip with a
 * primary ring. Deliberately compact ("very small, professional") — the same
 * pill reads at home in the Agent chat's thinking state and the Player's
 * first-run generating state, just with a different pattern/color per surface.
 */
export function GridLoaderPill({
	label,
	color = MULTICOLOR,
	mode = "pulse",
	pattern,
	sequence,
	className,
}: GridLoaderPillProps) {
	return (
		<div
			className={cn(
				"inline-flex items-center gap-2.5 rounded-full bg-white/10 px-4 py-2 backdrop-blur-sm",
				className,
			)}
		>
			<GridLoader
				color={color}
				gap={1}
				mode={mode}
				pattern={pattern}
				sequence={sequence}
				size="sm"
			/>
			<span className="font-medium text-sm text-white">{label}</span>
		</div>
	);
}
