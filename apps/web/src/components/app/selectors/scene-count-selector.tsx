"use client";

import {
	MAX_SCENES_PER_GENERATION,
	MIN_SCENES_PER_GENERATION,
} from "@video-platform-challenge/types";
import { ChevronDownIcon, ClapperboardIcon } from "lucide-react";
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

const SceneCountSchema = z.coerce
	.number()
	.int()
	.min(MIN_SCENES_PER_GENERATION)
	.max(MAX_SCENES_PER_GENERATION);

// Curated steps rather than every value in 1..10 (user call): five options
// keep the menu scannable; the schema bounds (MIN/MAX_SCENES_PER_GENERATION,
// validated by SceneCountSchema above) stay the real contract guardrail.
const SCENE_COUNT_OPTIONS: number[] = [1, 3, 5, 7, 10];

function sceneCountLabel(count: number): string {
	return count === 1 ? "1 scene" : `${count} scenes`;
}

export type SceneCountSelectorProps = {
	value: number;
	onChange: (next: number) => void;
	disabled?: boolean;
	className?: string;
};

/**
 * Scenes-per-batch selector (docs scenes-architecture-v3.md "Composer
 * selectors everywhere"): how many scenes the next generation batch
 * produces. Shared by the Home composer, the global AI dock's create-project
 * form, and the Studio dock's extension batch size — one component, so the
 * three surfaces never drift. Same shadcn `DropdownMenu` pattern as
 * `VoiceLanguageSelector`/`SubtitleLanguageSelector` (`size="sm"` ghost
 * `Button` trigger, single-select `DropdownMenuRadioGroup`). Options are the
 * curated `SCENE_COUNT_OPTIONS` steps within MIN..MAX_SCENES_PER_GENERATION;
 * callers default to `INITIAL_SCENE_COUNT`.
 */
export function SceneCountSelector({
	value,
	onChange,
	disabled,
	className,
}: SceneCountSelectorProps) {
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
					<ClapperboardIcon size={14} />
					{sceneCountLabel(value)}
					<ChevronDownIcon className="text-muted-foreground" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				<DropdownMenuRadioGroup
					value={String(value)}
					onValueChange={(raw) => {
						const parsed = SceneCountSchema.safeParse(raw);
						if (parsed.success) {
							onChange(parsed.data);
						}
					}}
				>
					{SCENE_COUNT_OPTIONS.map((count) => (
						<DropdownMenuRadioItem key={count} value={String(count)}>
							<ClapperboardIcon size={14} className="shrink-0" />
							{/* whitespace-nowrap: "10 scenes" must never wrap to two
							    lines inside the fixed-width menu (user call). */}
							<span className="whitespace-nowrap">
								{sceneCountLabel(count)}
							</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
