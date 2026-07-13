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

// System-installed families only (no new webfont load): every option here
// resolves consistently in both the DOM overlay (browser default font
// fallback) and the export burn-in (canvas `fillText`, which silently falls
// back to the platform default for anything not installed) — see
// `export.ts`'s `document.fonts.ready` comment for why an actually-missing
// family would otherwise burn in wrong.
const FONT_FAMILY_OPTIONS = [
	{ label: "Inter", value: "Inter" },
	{ label: "Arial", value: "Arial" },
	{ label: "Georgia", value: "Georgia" },
	{ label: "Verdana", value: "Verdana" },
	{ label: "Trebuchet MS", value: "Trebuchet MS" },
	{ label: "Impact", value: "Impact" },
	{ label: "Courier New", value: "Courier New" },
];

const POSITION_OPTIONS = ["top", "bottom"] as const;

const DEFAULT_BACKGROUND_COLOR = "rgba(0, 0, 0, 0.55)";

const LINE_HEIGHT_MIN = 1;
const LINE_HEIGHT_MAX = 2;
const MAX_WIDTH_PERCENT_MIN = 40;
const MAX_WIDTH_PERCENT_MAX = 100;

/**
 * Subtitles tab (docs/studio-ui.md §1): style controls bound to
 * `projects.subtitle_style` — every tweak previews live on the Player
 * overlay (same object the Remotion composition reads, so there's no
 * separate preview model to keep in sync). `subtitleStyleSchema`
 * (packages/api) has no dedicated outline-WIDTH field (only
 * `outlineColor`) and models "background on/off" as
 * presence/absence of `backgroundColor` rather than a boolean — the Switch
 * below writes/clears a fixed color instead of toggling a flag. Same
 * presence/absence pattern for `textShadow` (a real boolean field, unlike
 * background) — the intensity slider only renders while the toggle is on.
 * Studio quality pass §3 (controls only — no per-cue timing): font family,
 * line height, max width, and text shadow are the fields added on top of
 * the original size/weight/color/outline/background/position set.
 */
export function SubtitlesPanel() {
	const { subtitleStyle, updateSubtitleStyle } = useStudio();
	const fontSize =
		subtitleStyle.fontSize ?? DEFAULT_SUBTITLE_STYLE.fontSize ?? 48;
	const weight = subtitleStyle.weight ?? "medium";
	const font = subtitleStyle.font ?? DEFAULT_SUBTITLE_STYLE.font ?? "Inter";
	const color = subtitleStyle.color ?? "#ffffff";
	const outlineColor = subtitleStyle.outlineColor ?? "#000000";
	const position = subtitleStyle.position ?? "bottom";
	const hasBackground = Boolean(subtitleStyle.backgroundColor);
	const lineHeight =
		subtitleStyle.lineHeight ?? DEFAULT_SUBTITLE_STYLE.lineHeight ?? 1.2;
	const maxWidthPercent =
		subtitleStyle.maxWidthPercent ??
		DEFAULT_SUBTITLE_STYLE.maxWidthPercent ??
		90;
	const hasTextShadow = Boolean(subtitleStyle.textShadow);
	const textShadowIntensity =
		subtitleStyle.textShadowIntensity ??
		DEFAULT_SUBTITLE_STYLE.textShadowIntensity ??
		50;

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

			<div className="grid grid-cols-2 gap-3">
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
				<div className="flex flex-col gap-2">
					<Label htmlFor="subtitle-font">Font</Label>
					<Select
						value={font}
						onValueChange={(value) => updateSubtitleStyle({ font: value })}
					>
						<SelectTrigger id="subtitle-font" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{FONT_FAMILY_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
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

			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between">
					<Label htmlFor="subtitle-line-height">Line height</Label>
					<span className="text-muted-foreground text-xs">
						{lineHeight.toFixed(2)}×
					</span>
				</div>
				<Slider
					id="subtitle-line-height"
					min={LINE_HEIGHT_MIN}
					max={LINE_HEIGHT_MAX}
					step={0.05}
					value={[lineHeight]}
					onValueChange={([value]) =>
						value !== undefined && updateSubtitleStyle({ lineHeight: value })
					}
				/>
			</div>

			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between">
					<Label htmlFor="subtitle-max-width">Max width</Label>
					<span className="text-muted-foreground text-xs">
						{maxWidthPercent}%
					</span>
				</div>
				<Slider
					id="subtitle-max-width"
					min={MAX_WIDTH_PERCENT_MIN}
					max={MAX_WIDTH_PERCENT_MAX}
					step={5}
					value={[maxWidthPercent]}
					onValueChange={([value]) =>
						value !== undefined &&
						updateSubtitleStyle({ maxWidthPercent: value })
					}
				/>
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
				<div className="flex items-center justify-between">
					<Label htmlFor="subtitle-shadow">Text shadow</Label>
					<Switch
						id="subtitle-shadow"
						checked={hasTextShadow}
						onCheckedChange={(checked) =>
							updateSubtitleStyle({ textShadow: checked })
						}
					/>
				</div>
				{hasTextShadow ? (
					<div className="flex items-center justify-between gap-3">
						<span className="text-muted-foreground text-xs">Intensity</span>
						<Slider
							aria-label="Shadow intensity"
							min={0}
							max={100}
							step={5}
							value={[textShadowIntensity]}
							onValueChange={([value]) =>
								value !== undefined &&
								updateSubtitleStyle({ textShadowIntensity: value })
							}
						/>
						<span className="w-8 shrink-0 text-right text-muted-foreground text-xs">
							{textShadowIntensity}%
						</span>
					</div>
				) : null}
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
