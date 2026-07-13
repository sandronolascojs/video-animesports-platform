"use client";

import { BorderBeam } from "border-beam";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/libs/utils";

export type MainButtonProps = ComponentProps<typeof Button> & {
	/**
	 * Class for the BorderBeam wrapper (the actual layout box — the beam
	 * renders around it). Defaults to shrink-wrapping the button; pass
	 * "block w-full" for full-width form CTAs.
	 */
	wrapperClassName?: string;
};

/**
 * Main CTA — a shadcn `Button` carrying the chat composer's glass material
 * (`glass-composer` in globals.css: hairline white border, translucent card
 * fill, diagonal sheen, inset top highlight, backdrop blur) wrapped in an
 * always-on colorful BorderBeam. Base variant is `ghost` so the glass
 * utility fully owns background/border/shadow instead of fighting the
 * primitive's `outline` variant classes (same trick as `BeamButton`); hover
 * lifts the fill one step without losing the material. Theme is pinned to
 * "dark" — the app forces dark via ThemeProvider, so the resolved theme can
 * never differ and the SSR/first-paint guard BeamButton needs is moot here.
 */
export function MainButton({
	className,
	size = "lg",
	wrapperClassName,
	...props
}: MainButtonProps) {
	return (
		<BorderBeam
			active
			size="md"
			colorVariant="colorful"
			strength={0.7}
			theme="dark"
			className={cn("inline-block", wrapperClassName)}
		>
			<Button
				variant="ghost"
				size={size}
				className={cn(
					"glass-composer hover:bg-white/5 hover:text-foreground active:translate-y-0",
					className,
				)}
				{...props}
			/>
		</BorderBeam>
	);
}
