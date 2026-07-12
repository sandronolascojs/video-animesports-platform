"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
	type StudioDockFormInput,
	type StudioDockInput,
	studioDockInputSchema,
} from "@video-platform-challenge/api";
import { INITIAL_SCENE_COUNT } from "@video-platform-challenge/types";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { AIDockInput } from "@/components/kit/ai-dock";
import { SceneCountSelector } from "@/components/kit/selectors/scene-count-selector";
import {
	isChatWorking,
	useStudioChat,
} from "@/feature/studio/stores/studio-chat-provider";

const COMPOSER_PLACEHOLDERS = [
	"Ask the Director anything…",
	"Extend the story by 2 scenes…",
	"Retry the failed shot…",
	"Render the current cut…",
];

/**
 * Carried over from the removed `StudioDock` (Batch C fix 8): appending
 * "(target scene count: N)" to EVERY message — even ones unrelated to
 * generation, like "swap scenes 2 and 4" — would leak form plumbing into the
 * conversation. Only forward the hint when the scene-count pill is actually
 * away from its default: that's the signal the user expressed explicit
 * intent about scene count, still worth honoring verbatim. A default-valued
 * pill carries no signal either way, so nothing is appended and the prompt
 * goes through clean.
 */
function buildAgentMessage(prompt: string, sceneCount: number): string {
	if (sceneCount === INITIAL_SCENE_COUNT) {
		return prompt;
	}
	return `${prompt} (target scene count: ${sceneCount})`;
}

/**
 * The rail's composer — the SAME `AIDockInput` glass surface the removed
 * floating dock used (docs/studio-design-language.md §0.4 "glass material
 * for elevated surfaces"), now the Studio's ONLY chat input
 * (§3d). Sending from here keeps the rail open.
 *
 * The scene-count pill moved here from the deleted `StudioDock`'s toolbar
 * (§3d/§3f "the selector toolbar ... renders as param pills"): the primary
 * way to add scenes is now the agent itself (natural language, or the empty
 * state's suggestion rows), but an explicit count still rides an extend
 * request via `buildAgentMessage` above.
 *
 * // TODO(docs/studio-design-language.md §3d): voice/subtitle language
 * // selectors don't fit this 23rem rail without crowding the composer next
 * // to the scene-count pill and submit button, so they were dropped from
 * // the Studio here. `update_languages` still works via natural-language
 * // chat (the agent's own tool) — re-introduce as compact pills only if the
 * // rail widens further.
 *
 * Double-submit guard (docs §8a fix 3): gated on `isChatWorking(status)`
 * exactly like the removed `StudioDock`'s submit handler — a turn already in
 * flight (submitted/streaming) must not accept a second concurrent send.
 */
export function AgentChatComposer() {
	// Three explicit generics (input, context, output): `sceneCount`'s zod
	// `.default()` splits the schema's input type (optional) from its output
	// (required number) — same reasoning as the removed `StudioDock`'s
	// identical form.
	const form = useForm<StudioDockFormInput, unknown, StudioDockInput>({
		defaultValues: { prompt: "", sceneCount: INITIAL_SCENE_COUNT },
		resolver: zodResolver(studioDockInputSchema),
	});
	const prompt = form.watch("prompt") ?? "";
	// `?? INITIAL_SCENE_COUNT` narrows the input-side optionality — the
	// defaultValues above guarantee a value at runtime.
	const sceneCount = form.watch("sceneCount") ?? INITIAL_SCENE_COUNT;
	const { sendMessage, status, stop, prefillSignal, prefillText } =
		useStudioChat();
	// Bumped once a prefill lands (below) so `AIDockInput` imperatively
	// focuses its textarea — same "click commits + focuses" handoff as Home's
	// template cards (`ai-dock-input.tsx`'s own `focusSignal` doc comment),
	// so clicking a suggestion row hands straight into typing/sending.
	const [focusSignal, setFocusSignal] = useState<number>();

	// `prefillSignal` (studio-chat-provider.tsx) is the empty state's
	// suggestion rows handing text into this composer's own form state — a
	// signal, not just the text, so clicking the SAME suggestion twice in a
	// row still re-applies it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `form` is a react-hook-form instance, stable for this component's lifetime — adding it would re-run this effect every render.
	useEffect(() => {
		if (prefillSignal === undefined) {
			return;
		}
		form.setValue("prompt", prefillText);
		setFocusSignal((current) => (current ?? 0) + 1);
	}, [prefillSignal, prefillText]);

	const onSubmit = form.handleSubmit((values) => {
		if (isChatWorking(status)) {
			return;
		}
		// `useChat`'s own `onError` (studio-chat-provider.tsx) already toasts
		// and logs a failed turn — this catch exists ONLY so a rejected
		// `sendMessage()` promise never becomes an unhandled rejection (fix 2d).
		void sendMessage({
			text: buildAgentMessage(values.prompt, values.sceneCount),
		}).catch(() => {});
		// Only the text clears — the selected sceneCount is preserved across
		// sends (matches the removed dock's behavior, where the pill never
		// reset).
		form.resetField("prompt");
	});

	return (
		<AIDockInput
			mode="floating"
			value={prompt}
			onChange={(next) => form.setValue("prompt", next)}
			onSubmit={onSubmit}
			placeholders={COMPOSER_PLACEHOLDERS}
			leftToolbar={
				<SceneCountSelector
					value={sceneCount}
					onChange={(next) => form.setValue("sceneCount", next)}
				/>
			}
			status={status}
			onStop={stop}
			focusSignal={focusSignal}
		/>
	);
}
