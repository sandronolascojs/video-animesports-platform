"use client";

import { AudioLanguage } from "@video-platform-challenge/types";
import { ChevronDownIcon, MicIcon } from "lucide-react";
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

export type VoiceLanguage = AudioLanguage;

const VoiceLanguageSchema = z.enum([
	AudioLanguage.JAPANESE,
	AudioLanguage.ENGLISH,
]);

const VOICE_LANGUAGE_ORDER: VoiceLanguage[] = [
	AudioLanguage.JAPANESE,
	AudioLanguage.ENGLISH,
];

const VOICE_LANGUAGE_LABEL: Record<VoiceLanguage, string> = {
	[AudioLanguage.JAPANESE]: "Japanese",
	[AudioLanguage.ENGLISH]: "English",
};

export type VoiceLanguageSelectorProps = {
	value: VoiceLanguage;
	onChange: (next: VoiceLanguage) => void;
	disabled?: boolean;
	className?: string;
};

/**
 * Audio-voice-language selector, shared by the Home composer and the Studio
 * dock (docs/studio-ui.md "Creation options": language selectors appear in
 * BOTH; aspect ratio stays Home-only). Same shadcn `DropdownMenu` pattern as
 * `AspectRatioSelector` (`size="sm"` ghost `Button` trigger); the mic icon
 * represents the "voice" category rather than a per-language brand mark, so
 * it stays fixed across both options instead of switching per value.
 */
export function VoiceLanguageSelector({
	value,
	onChange,
	disabled,
	className,
}: VoiceLanguageSelectorProps) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild disabled={disabled}>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className={cn("gap-1.5 font-medium text-foreground", className)}
				>
					<MicIcon size={14} />
					{VOICE_LANGUAGE_LABEL[value]}
					<ChevronDownIcon className="text-muted-foreground" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				<DropdownMenuRadioGroup
					value={value}
					onValueChange={(raw) => {
						const parsed = VoiceLanguageSchema.safeParse(raw);
						if (parsed.success) {
							onChange(parsed.data);
						}
					}}
				>
					{VOICE_LANGUAGE_ORDER.map((lang) => (
						<DropdownMenuRadioItem key={lang} value={lang}>
							<MicIcon size={14} className="shrink-0" />
							{VOICE_LANGUAGE_LABEL[lang]}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
