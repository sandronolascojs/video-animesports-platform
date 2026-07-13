import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/libs/utils";

/**
 * Style recipe for the AIDock's primary action button — `size="sm"`
 * scale (`h-8 w-8`, matching this input's other `sm` controls) — filled
 * primary when submittable, muted outline otherwise. Exposed as a `cva`
 * class-generator so `PromptInputSubmit` — which renders its own `<button>`
 * — can adopt the recipe via `className`, and as a standalone `ActionButton`
 * component for any other icon-button reuse.
 */
export const actionButtonVariants = cva(
	"flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-none transition-[transform,background-color,color,border-color] duration-150 active:scale-[0.97] disabled:opacity-100",
	{
		variants: {
			active: {
				true: "bg-primary text-primary-foreground hover:bg-primary/90",
				false:
					"border border-border bg-transparent text-muted-foreground/45 hover:bg-transparent",
			},
		},
		defaultVariants: {
			active: false,
		},
	},
);

export type ActionButtonProps = ComponentProps<"button"> &
	VariantProps<typeof actionButtonVariants>;

/**
 * Standalone icon-button using the AIDock submit recipe. `AIDockInput`
 * itself doesn't render this directly — it applies `actionButtonVariants`
 * as a `className` on AI Elements' `PromptInputSubmit` so the button keeps
 * behaving like a submit control — this component is for any other spot
 * that needs the identical look (e.g. kit page gallery, future reuse).
 */
export function ActionButton({
	className,
	active,
	type = "button",
	...props
}: ActionButtonProps) {
	return (
		<button
			data-slot="action-button"
			type={type}
			className={cn(actionButtonVariants({ active, className }))}
			{...props}
		/>
	);
}
