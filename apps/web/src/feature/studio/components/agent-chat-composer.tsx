"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
	type AgentComposerInput,
	agentComposerInputSchema,
} from "@video-platform-challenge/api";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { AIDockInput } from "@/components/kit/ai-dock";
import {
	isChatWorking,
	useStudioChat,
} from "@/feature/studio/stores/studio-chat-provider";

const COMPOSER_PLACEHOLDERS = [
	"Ask the Agent anything…",
	"Extend the story by 2 scenes…",
	"Retry the failed shot…",
	"Render the current cut…",
];

/**
 * The rail's composer — the SAME `AIDockInput` glass surface the removed
 * floating dock used (docs/studio-design-language.md §0.4 "glass material
 * for elevated surfaces"), now the Studio's ONLY chat input
 * (§3d). Sending from here keeps the rail open.
 *
 * No scene-count selector (docs/studio-quality-pass.md §6e): the agent
 * infers how many scenes to create/extend from the conversation itself, so
 * the manual pill that used to live in this composer's `leftToolbar` was
 * redundant with — and could disagree with — that judgment call. Removing it
 * also drops the `studioDockInputSchema` extension (the `sceneCount` field
 * plus its "(target scene count: N)" message hint) in favor of the plain
 * `agentComposerInputSchema` (`{ prompt }` only), so the submit handler no
 * longer depends on a chosen scene count at all. `SceneCountSelector` itself
 * is untouched — Home's own composer (`composer-toolbar.tsx`) still uses it
 * for initial project creation, a separate flow.
 *
 * // TODO(docs/studio-design-language.md §3d): voice/subtitle language
 * // selectors don't fit this 23rem rail without crowding the composer next
 * // to the submit button, so they were dropped from the Studio here.
 * // `update_languages` still works via natural-language chat (the agent's
 * // own tool) — re-introduce as compact pills only if the rail widens
 * // further.
 *
 * Double-submit guard (docs §8a fix 3): gated on `isChatWorking(status)`
 * exactly like the removed `StudioDock`'s submit handler — a turn already in
 * flight (submitted/streaming) must not accept a second concurrent send.
 */
export function AgentChatComposer() {
	const form = useForm<AgentComposerInput>({
		defaultValues: { prompt: "" },
		resolver: zodResolver(agentComposerInputSchema),
	});
	const prompt = form.watch("prompt") ?? "";
	const { sendMessage, status, stop, prefillSignal, prefillText } =
		useStudioChat();
	// Bumped once a prefill lands (below) so `AIDockInput` imperatively
	// focuses its textarea — same "click commits + focuses" handoff as Home's
	// template cards (`ai-dock-input.tsx`'s own `focusSignal` doc comment),
	// so clicking a suggestion row hands straight into typing/sending.
	const [focusSignal, setFocusSignal] = useState<number>();

	// `prefillSignal` (studio-chat-provider.tsx) is the empty state's
	// suggestion bubbles handing text into this composer's own form state — a
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
		void sendMessage({ text: values.prompt }).catch(() => {});
		form.resetField("prompt");
	});

	return (
		<AIDockInput
			mode="floating"
			value={prompt}
			onChange={(next) => form.setValue("prompt", next)}
			onSubmit={onSubmit}
			placeholders={COMPOSER_PLACEHOLDERS}
			status={status}
			onStop={stop}
			focusSignal={focusSignal}
		/>
	);
}
