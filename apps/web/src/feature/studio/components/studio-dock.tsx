"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
	type StudioDockFormInput,
	type StudioDockInput,
	studioDockInputSchema,
} from "@video-platform-challenge/api";
import { INITIAL_SCENE_COUNT } from "@video-platform-challenge/types";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { AIDock } from "@/components/kit/ai-dock";
import { SceneCountSelector } from "@/components/kit/selectors/scene-count-selector";
import { DockLanguageSelectors } from "@/feature/studio/components/dock-language-selectors";
import {
	isChatWorking,
	useStudioChat,
} from "@/feature/studio/stores/studio-chat-provider";

const DOCK_PLACEHOLDERS = [
	"Ask the agent to edit this project…",
	"Swap scenes 2 and 4…",
	"Make scene 5 shorter, like 5 seconds…",
	"The goalkeeper looks wrong, redo his character sheet…",
];

const TASK_NAME_MAX_LENGTH = 48;

/**
 * Batch C fix 8: appending "(generate N scenes)" to EVERY dock message —
 * even ones with nothing to do with generation, like "swap scenes 2 and
 * 4" — leaked form plumbing into the conversation the agent (and the user,
 * re-reading their own history) sees. Only forward the scene-count hint when
 * the dropdown is actually away from its default: that's the signal the user
 * expressed explicit intent about scene count, so it's still worth honoring
 * verbatim. A default-valued dropdown carries no signal either way, so nothing
 * is appended and the prompt goes through clean.
 */
function buildDockMessage(prompt: string, sceneCount: number): string {
	if (sceneCount === INITIAL_SCENE_COUNT) {
		return prompt;
	}
	return `${prompt} (target scene count: ${sceneCount})`;
}

export function StudioDock({ projectId }: { projectId: string }) {
	// Three explicit generics (input, context, output): `sceneCount`'s zod
	// `.default()` splits the schema's input type (optional) from its output
	// (required number) — same reasoning as create-project-modal's identical
	// form.
	const form = useForm<StudioDockFormInput, unknown, StudioDockInput>({
		defaultValues: { prompt: "", sceneCount: INITIAL_SCENE_COUNT },
		resolver: zodResolver(studioDockInputSchema),
	});
	const prompt = form.watch("prompt") ?? "";
	// `?? INITIAL_SCENE_COUNT` narrows the input-side optionality — the
	// defaultValues above guarantee a value at runtime.
	const sceneCount = form.watch("sceneCount") ?? INITIAL_SCENE_COUNT;
	const [taskName, setTaskName] = useState<string>();
	const {
		open: openChat,
		sendMessage,
		status,
		messages,
		stop,
	} = useStudioChat();

	const isWorking = isChatWorking(status);
	const hasMessages = messages.length > 0;

	const onSubmit = form.handleSubmit((values) => {
		if (isWorking) {
			return;
		}
		setTaskName(
			values.prompt.length > TASK_NAME_MAX_LENGTH
				? `${values.prompt.slice(0, TASK_NAME_MAX_LENGTH)}…`
				: values.prompt,
		);
		void sendMessage({
			text: buildDockMessage(values.prompt, values.sceneCount),
		})
			.catch(() => {
				// `useChat`'s own `onError` (studio-chat-provider.tsx) already
				// toasts and logs a failed turn — this catch exists ONLY so a
				// rejected `sendMessage()` promise never becomes an unhandled
				// rejection (fix 2d).
			})
			.finally(() => {
				// Runs on both success and failure (fix 7) — previously only
				// `.then()` cleared the status-bar label, so a failed send left
				// a stale taskName displayed indefinitely.
				window.setTimeout(() => setTaskName(undefined), 2000);
			});
		// Only the text clears — the selected sceneCount is preserved across
		// sends (matches the previous behavior, where the dropdown never reset).
		form.resetField("prompt");
	});

	return (
		<AIDock
			value={prompt}
			onChange={(next) => form.setValue("prompt", next)}
			onSubmit={onSubmit}
			placeholders={DOCK_PLACEHOLDERS}
			leftToolbar={
				<>
					<DockLanguageSelectors projectId={projectId} />
					<SceneCountSelector
						value={sceneCount}
						onChange={(next) => form.setValue("sceneCount", next)}
					/>
				</>
			}
			taskName={taskName}
			isWorking={isWorking}
			hasMessages={hasMessages}
			status={status}
			onOpenSidebar={openChat}
			onStop={stop}
		/>
	);
}
