import Image from "next/image";
import type { CSSProperties } from "react";

import { cn } from "@/libs/utils";

export type TemplateCardProps = {
	/** Thumbnail image src. Omit to render a gradient placeholder. */
	image?: string;
	title: string;
	prompt: string;
	selected?: boolean;
	onHoverChange?: (hovering: boolean) => void;
	onSelect?: () => void;
	/** Placeholder gradient pair (used only when `image` is absent). */
	from?: string;
	to?: string;
	className?: string;
	style?: CSSProperties;
};

/**
 * Apple-card style template tile: full-bleed artwork, a progressive frosted
 * ramp at the bottom (the apple-invites stacked-backdrop-blur recipe, each
 * layer masked by `gradient-mask-t-0`) carrying the mini title + prompt, and
 * the composer's glass border treatment (hairline white border + inset top
 * highlight — same material language as `glass-composer`). Cards are STATIC;
 * hovering lifts the card up cleanly (`-translate-y-2`, gated behind
 * `can-hover` so touch devices don't get sticky hover states).
 */
export function TemplateCard({
	image,
	title,
	prompt,
	selected = false,
	onHoverChange,
	onSelect,
	from = "var(--chart-1)",
	to = "var(--chart-2)",
	className,
	style,
}: TemplateCardProps) {
	return (
		<button
			type="button"
			aria-pressed={selected}
			onMouseEnter={() => onHoverChange?.(true)}
			onMouseLeave={() => onHoverChange?.(false)}
			onFocus={() => onHoverChange?.(true)}
			onBlur={() => onHoverChange?.(false)}
			onClick={onSelect}
			style={style}
			className={cn(
				"group relative aspect-[3/4] w-40 shrink-0 overflow-hidden rounded-2xl text-left",
				// The chat input's border, made READABLE over artwork: identical
				// hairline (1px white/5) + identical highlight/drop shadows, plus
				// ONE addition — an inset 1px dark line under the hairline. On the
				// input the translucent dark fill provides that contrast bed for
				// free; full-bleed art doesn't, so the card carries its own.
				"border border-white/[0.05]",
				"shadow-[inset_0_0.125rem_0.1875rem_0_rgba(255,255,255,0.05),inset_0_0_0_1px_rgba(0,0,0,0.45),0_0.125rem_0.25rem_-0.03125rem_rgba(0,0,0,0.12)]",
				// Clean hover lift, no movement otherwise.
				"can-hover:-translate-y-2 transition-transform duration-200 ease-out active:translate-y-0",
				selected && "ring-2 ring-primary/35",
				className,
			)}
		>
			{image ? (
				<Image
					src={image}
					alt={title}
					fill
					sizes="160px"
					className="object-cover"
				/>
			) : (
				<div
					className="absolute inset-0"
					style={{
						backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
					}}
				/>
			)}
			{/*
			 * Frosted bottom, done the way it actually renders smoothly: a
			 * masked BLURRED COPY of the artwork itself. Chromium does not
			 * attenuate `backdrop-filter` through a mask gradient — wherever
			 * mask alpha > 0 the backdrop blur composites at ~full strength,
			 * which produced the hard onset line in every stacked-backdrop
			 * attempt. A plain `filter: blur()` on a second copy of the image
			 * is ordinary painted content, so the mask fades it perfectly —
			 * sharp art dissolving into frost with no seam (the apple-invites
			 * look). `scale-110` hides the blur's soft edges at the borders.
			 */}
			{image ? (
				<div
					aria-hidden
					className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_top,black_0%,black_16%,transparent_52%)]"
				>
					<Image
						src={image}
						alt=""
						fill
						sizes="160px"
						className="scale-110 object-cover blur-[8px]"
					/>
				</div>
			) : null}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.45),transparent_45%)]"
			/>
			<span className="absolute inset-x-0 bottom-0 z-10 block p-3 text-white">
				<span className="block truncate font-medium text-sm">{title}</span>
				<span className="block truncate text-white/70 text-xs">{prompt}</span>
			</span>
		</button>
	);
}
