"use client";

import { BorderBeam } from "border-beam";
import { useTheme } from "next-themes";
import type { ComponentProps } from "react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/libs/utils";

export type BeamButtonProps = ComponentProps<typeof Button> & {
	/** Whether the beam animation runs. @default true */
	beamActive?: boolean;
};

/**
 * Primary CTA — a shadcn `Button` wrapped in the BorderBeam signature effect
 * (docs/studio-ui.md "Design language": beam reuse sites include "primary
 * CTA emphasis moments", alongside the AIDock composer, which already
 * gets it on focus). Base variant is reset to `ghost` so the `.cta-glow`
 * recipe fully owns background/border/shadow/color instead of fighting the
 * Button primitive's own `default` variant bg — ghost's own hover state is
 * then overridden back to the primary look via `cn`'s twMerge dedupe. Same
 * mounted-theme guard as AIDockInput so SSR output matches the first client
 * paint (BorderBeam injects a theme-keyed <style> tag).
 */
export function BeamButton({
	className,
	beamActive = true,
	size = "lg",
	...props
}: BeamButtonProps) {
	const { resolvedTheme } = useTheme();
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	return (
		<BorderBeam
			active={beamActive}
			size="sm"
			colorVariant="mono"
			theme={mounted && resolvedTheme === "light" ? "light" : "dark"}
			className="block w-full"
		>
			<Button
				variant="ghost"
				size={size}
				className={cn(
					"cta-glow w-full gap-1.5 rounded-xl hover:bg-primary hover:text-primary-foreground active:translate-y-0",
					className,
				)}
				{...props}
			/>
		</BorderBeam>
	);
}
