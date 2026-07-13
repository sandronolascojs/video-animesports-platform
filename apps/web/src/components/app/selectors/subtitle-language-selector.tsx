"use client";

import { SubtitleLanguage as SharedSubtitleLanguage } from "@video-platform-challenge/types";
import { CaptionsIcon, ChevronDownIcon } from "lucide-react";
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

// Re-exported under the file's original name (rather than `SharedSubtitleLanguage`)
// so existing consumers importing `SubtitleLanguage` from this module keep working.
export type SubtitleLanguage = SharedSubtitleLanguage;

const SubtitleLanguageSchema = z.enum([
	SharedSubtitleLanguage.ENGLISH,
	SharedSubtitleLanguage.JAPANESE,
]);

const SUBTITLE_LANGUAGE_ORDER: SubtitleLanguage[] = [
	SharedSubtitleLanguage.ENGLISH,
	SharedSubtitleLanguage.JAPANESE,
];

const SUBTITLE_LANGUAGE_LABEL: Record<SubtitleLanguage, string> = {
	[SharedSubtitleLanguage.ENGLISH]: "English",
	[SharedSubtitleLanguage.JAPANESE]: "Japanese",
};

export type SubtitleLanguageSelectorProps = {
	value: SubtitleLanguage;
	onChange: (next: SubtitleLanguage) => void;
	disabled?: boolean;
	className?: string;
};

/**
 * Home-only subtitle-language toggle (docs/studio-ui.md "Creation
 * options... HOME ONLY"). Same shadcn `DropdownMenu` pattern as
 * `VoiceLanguageSelector` (`size="sm"` ghost `Button` trigger) — a fixed
 * captions icon represents the category, not per-language branding.
 */
export function SubtitleLanguageSelector({
	value,
	onChange,
	disabled,
	className,
}: SubtitleLanguageSelectorProps) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild disabled={disabled}>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className={cn(
						"gap-1.5 rounded-lg text-[13px] text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
						className,
					)}
				>
					<CaptionsIcon size={14} />
					{SUBTITLE_LANGUAGE_LABEL[value]}
					<ChevronDownIcon className="text-muted-foreground" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				<DropdownMenuRadioGroup
					value={value}
					onValueChange={(raw) => {
						const parsed = SubtitleLanguageSchema.safeParse(raw);
						if (parsed.success) {
							onChange(parsed.data);
						}
					}}
				>
					{SUBTITLE_LANGUAGE_ORDER.map((lang) => (
						<DropdownMenuRadioItem key={lang} value={lang}>
							<CaptionsIcon size={14} />
							{SUBTITLE_LANGUAGE_LABEL[lang]}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
