import type { CSSProperties, ElementType } from "react";

import { cn } from "@/libs/utils";

export type JewelIconProps = {
	/** Any icon component that takes className/style — lucide and Phosphor both fit. */
	icon: ElementType;
	/** Gradient start — any valid CSS color, defaults to the primary token. */
	from?: string;
	/** Gradient end — any valid CSS color, defaults to the chart-2 token. */
	to?: string;
	/** Chip size in px (square). */
	size?: number;
	className?: string;
};

/**
 * Layered gradient icon chip — see `.jewel-chip` in globals.css. The brand
 * pair is parameterized via --jewel-from/--jewel-to so callers can compose
 * distinct chip colors without hardcoding a palette in the utility itself.
 */
export function JewelIcon({
	icon: Icon,
	from,
	to,
	size = 32,
	className,
}: JewelIconProps) {
	return (
		<span
			className={cn("jewel-chip", className)}
			style={
				{
					"--jewel-from": from,
					"--jewel-to": to,
					height: size,
					width: size,
				} as CSSProperties
			}
		>
			<Icon
				className="text-white"
				style={{ height: size * 0.55, width: size * 0.55 }}
			/>
		</span>
	);
}
