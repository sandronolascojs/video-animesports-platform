"use client";

import { SubtitleLanguageSelector } from "@/components/kit/selectors/subtitle-language-selector";
import { VoiceLanguageSelector } from "@/components/kit/selectors/voice-language-selector";
import { useUpdateLanguages } from "@/feature/studio/hooks/http/use-project";
import { useStudio } from "@/feature/studio/stores/use-studio";

/**
 * Dock language selectors (docs/studio-ui.md "Creation options": voice +
 * subtitle language appear in BOTH the Home composer and the Studio dock —
 * here they read/write the project's persisted languages directly via
 * `useUpdateLanguages`, no local form state, since there's no "submit" step
 * distinct from the selection itself).
 */
export function DockLanguageSelectors({ projectId }: { projectId: string }) {
	const { project } = useStudio();
	const updateLanguages = useUpdateLanguages(projectId);

	return (
		<>
			<VoiceLanguageSelector
				value={project.audioLanguage}
				onChange={(next) =>
					updateLanguages.mutate({ audioLanguage: next, id: projectId })
				}
			/>
			<SubtitleLanguageSelector
				value={project.subtitleLanguage}
				onChange={(next) =>
					updateLanguages.mutate({ id: projectId, subtitleLanguage: next })
				}
			/>
		</>
	);
}
