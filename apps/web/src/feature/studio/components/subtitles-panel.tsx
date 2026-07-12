"use client";

import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_SUBTITLE_STYLE } from "@/feature/studio/stores/draft-store";
import { useStudio } from "@/feature/studio/stores/use-studio";
import { cn } from "@/libs/utils";

const WEIGHT_OPTIONS = [
	{ label: "Regular", value: "regular" },
	{ label: "Medium", value: "medium" },
	{ label: "Bold", value: "bold" },
];

const POSITION_OPTIONS = ["top", "bottom"] as const;

const DEFAULT_BACKGROUND_COLOR = "rgba(0, 0, 0, 0.55)";

/**
 * Subtitles tab (docs/studio-ui.md §1): style controls bound to
 * `projects.subtitle_style` — every tweak previews live on the Player
 * overlay (same object the Remotion composition reads, so there's no
 * separate preview model to keep in sync). `subtitleStyleSchema`
 * (packages/api) has no dedicated outline-WIDTH field (only
 * `outlineColor`) and models "background on/off" as
 * presence/absence of `backgroundColor` rather than a boolean — the Switch
 * below writes/clears a fixed color instead of toggling a flag.
 */
export function SubtitlesPanel() {
	const { subtitleStyle, updateSubtitleStyle } = useStudio();
	const fontSize =
		subtitleStyle.fontSize ?? DEFAULT_SUBTITLE_STYLE.fontSize ?? 48;
	const weight = subtitleStyle.weight ?? "medium";
	const color = subtitleStyle.color ?? "#ffffff";
	const outlineColor = subtitleStyle.outlineColor ?? "#000000";
	const position = subtitleStyle.position ?? "bottom";
	const hasBackground = Boolean(subtitleStyle.backgroundColor);

	return (
		<div className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto pr-1">
			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between">
					<Label htmlFor="subtitle-size">Size</Label>
					<span className="text-muted-foreground text-xs">{fontSize}px</span>
				</div>
				<Slider
					id="subtitle-size"
					min={24}
					max={120}
					step={2}
					value={[fontSize]}
					onValueChange={([value]) =>
						value !== undefined && updateSubtitleStyle({ fontSize: value })
					}
				/>
			</div>

			<div className="flex flex-col gap-2">
				<Label htmlFor="subtitle-weight">Weight</Label>
				<Select
					value={weight}
					onValueChange={(value) => updateSubtitleStyle({ weight: value })}
				>
					<SelectTrigger id="subtitle-weight" className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{WEIGHT_OPTIONS.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="grid grid-cols-2 gap-3">
				<div className="flex flex-col gap-2">
					<Label htmlFor="subtitle-color">Text color</Label>
					<input
						id="subtitle-color"
						type="color"
						value={color}
						onChange={(event) =>
							updateSubtitleStyle({ color: event.target.value })
						}
						className="h-8 w-full cursor-pointer rounded-lg border border-input bg-transparent"
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="subtitle-outline-color">Outline color</Label>
					<input
						id="subtitle-outline-color"
						type="color"
						value={outlineColor}
						onChange={(event) =>
							updateSubtitleStyle({ outlineColor: event.target.value })
						}
						className="h-8 w-full cursor-pointer rounded-lg border border-input bg-transparent"
					/>
				</div>
			</div>

			<div className="flex items-center justify-between">
				<Label htmlFor="subtitle-background">Background</Label>
				<Switch
					id="subtitle-background"
					checked={hasBackground}
					onCheckedChange={(checked) =>
						updateSubtitleStyle({
							backgroundColor: checked ? DEFAULT_BACKGROUND_COLOR : undefined,
						})
					}
				/>
			</div>

			<div className="flex flex-col gap-2">
				<Label>Position</Label>
				<div className="flex items-center gap-1 rounded-full bg-white/5 p-1">
					{POSITION_OPTIONS.map((option) => (
						<button
							key={option}
							type="button"
							onClick={() => updateSubtitleStyle({ position: option })}
							aria-pressed={position === option}
							className={cn(
								"flex-1 rounded-full px-3 py-1.5 font-medium text-xs capitalize transition-colors duration-150 ease-out",
								position === option
									? "bg-background text-foreground shadow-sm"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{option}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
