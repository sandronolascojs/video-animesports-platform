"use client";

import type { AspectRatio } from "@video-platform-challenge/types";
import { SceneCountSelector } from "@/components/app/selectors/scene-count-selector";
import type { SubtitleLanguage } from "@/components/app/selectors/subtitle-language-selector";
import { SubtitleLanguageSelector } from "@/components/app/selectors/subtitle-language-selector";
import type { VoiceLanguage } from "@/components/app/selectors/voice-language-selector";
import { VoiceLanguageSelector } from "@/components/app/selectors/voice-language-selector";

import { AspectRatioSelector } from "@/feature/home/components/aspect-ratio-selector";

export type ComposerToolbarProps = {
	aspectRatio: AspectRatio;
	onAspectRatioChange: (value: AspectRatio) => void;
	voiceLanguage: VoiceLanguage;
	onVoiceLanguageChange: (value: VoiceLanguage) => void;
	subtitleLanguage: SubtitleLanguage;
	onSubtitleLanguageChange: (value: SubtitleLanguage) => void;
	sceneCount: number;
	onSceneCountChange: (value: number) => void;
};

/**
 * Home-only composer toolbar (docs/studio-ui.md "Creation options in the
 * AIDock toolbar — HOME ONLY"): aspect ratio + audio voice + subtitle
 * language + scenes count, each a ProviderSelector-pattern `Select`
 * (see aspect-ratio-selector.tsx). Mounted into `AIDockInput`'s bottom-left
 * `leftToolbar` slot by `HomeView` only — the Studio dock never renders
 * this (its `leftToolbar` stays empty; aspect ratio is immutable there).
 */
export function ComposerToolbar({
	aspectRatio,
	onAspectRatioChange,
	voiceLanguage,
	onVoiceLanguageChange,
	subtitleLanguage,
	onSubtitleLanguageChange,
	sceneCount,
	onSceneCountChange,
}: ComposerToolbarProps) {
	return (
		<div className="flex items-center gap-0.5">
			<AspectRatioSelector value={aspectRatio} onChange={onAspectRatioChange} />
			<VoiceLanguageSelector
				value={voiceLanguage}
				onChange={onVoiceLanguageChange}
			/>
			<SubtitleLanguageSelector
				value={subtitleLanguage}
				onChange={onSubtitleLanguageChange}
			/>
			<SceneCountSelector value={sceneCount} onChange={onSceneCountChange} />
		</div>
	);
}
