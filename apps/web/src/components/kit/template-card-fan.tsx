import type { CSSProperties, ReactNode } from "react";
import { Children } from "react";

import { cn } from "@/libs/utils";

const FAN_ROTATIONS = ["-6deg", "-2deg", "2deg", "6deg"] as const;
const FAN_OFFSETS = ["0.5rem", "0rem", "0rem", "0.5rem"] as const;

export type TemplateCardFanProps = {
	children: ReactNode;
	className?: string;
};

/**
 * Lays out up to 4 TemplateCards with alternating slight rotations/offsets
 * (Krea style) via plain CSS transforms on an inner wrapper, and a staggered
 * (50ms) entrance animation on the outer wrapper — kept on separate elements
 * so the entrance keyframe's `transform` never clobbers the static tilt.
 */
export function TemplateCardFan({ children, className }: TemplateCardFanProps) {
	const items = Children.toArray(children);

	return (
		<div className={cn("flex items-end justify-center gap-3", className)}>
			{items.map((child, index) => {
				const key =
					typeof child === "object" && child !== null && "key" in child
						? (child.key ?? index)
						: index;

				return (
					<div
						key={key}
						className="template-card-fan-item"
						style={{ animationDelay: `${index * 50}ms` } as CSSProperties}
					>
						<div
							style={
								{
									transform: `translateY(${FAN_OFFSETS[index % FAN_OFFSETS.length]}) rotate(${FAN_ROTATIONS[index % FAN_ROTATIONS.length]})`,
								} as CSSProperties
							}
						>
							{child}
						</div>
					</div>
				);
			})}
		</div>
	);
}
