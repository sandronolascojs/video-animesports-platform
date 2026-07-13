"use client";

import type { AspectRatio } from "@video-platform-challenge/types";
import type { LucideIcon } from "lucide-react";
import {
	ChevronDownIcon,
	RectangleHorizontalIcon,
	RectangleVerticalIcon,
} from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { cn } from "@/libs/utils";

const AspectRatioSchema = z.enum(["16:9", "9:16"]);

const ASPECT_RATIO_ORDER: AspectRatio[] = ["16:9", "9:16"];

const ASPECT_RATIO_UI: Record<
	AspectRatio,
	{ label: string; Icon: LucideIcon }
> = {
	"16:9": { label: "16:9", Icon: RectangleHorizontalIcon },
	"9:16": { label: "9:16", Icon: RectangleVerticalIcon },
};

export type AspectRatioSelectorProps = {
	value: AspectRatio;
	onChange: (next: AspectRatio) => void;
	disabled?: boolean;
	className?: string;
};

/**
 * Home-only aspect-ratio toggle (docs/studio-ui.md "Creation options in the
 * AIDock toolbar — HOME ONLY": "aspect ratio is immutable after
 * creation and is read from the project everywhere in the Studio", so the
 * Studio dock never renders this). Built on shadcn's `DropdownMenu` — a
 * `size="sm"` ghost `Button` trigger (icon + label + chevron), single-select
 * `DropdownMenuRadioGroup`/`DropdownMenuRadioItem` rows (built-in check
 * indicator).
 */
export function AspectRatioSelector({
	value,
	onChange,
	disabled,
	className,
}: AspectRatioSelectorProps) {
	const CurrentIcon = ASPECT_RATIO_UI[value].Icon;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild disabled={disabled}>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className={cn(
						"gap-1.5 rounded-lg text-[13px] text-muted-foreground tabular-nums hover:bg-white/[0.04] hover:text-foreground",
						className,
					)}
				>
					<CurrentIcon size={14} />
					{ASPECT_RATIO_UI[value].label}
					<ChevronDownIcon className="text-muted-foreground" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				<DropdownMenuRadioGroup
					value={value}
					onValueChange={(raw) => {
						const parsed = AspectRatioSchema.safeParse(raw);
						if (parsed.success) {
							onChange(parsed.data);
						}
					}}
				>
					{ASPECT_RATIO_ORDER.map((ratio) => {
						const meta = ASPECT_RATIO_UI[ratio];
						const Icon = meta.Icon;
						return (
							<DropdownMenuRadioItem key={ratio} value={ratio}>
								<Icon size={14} className="shrink-0" />
								{meta.label}
							</DropdownMenuRadioItem>
						);
					})}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
