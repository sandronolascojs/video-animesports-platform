"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
	type AgentComposerInput,
	agentComposerInputSchema,
} from "@video-platform-challenge/api";
import { useForm } from "react-hook-form";

import { AIDockInput } from "@/components/kit/ai-dock";
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
 * The sidebar's composer — the SAME `AIDockInput` surface the floating
 * `AIDock` uses (docs/ai-architecture-v1.md §2: "one input, two shells"),
 * just docked at the bottom of the rail instead of floating over the
 * editor. Sending from here keeps the sidebar open (docs: "Sending from the
 * sidebar keeps the sidebar open").
 *
 * Double-submit guard (docs §8a fix 3): gated on `isChatWorking(status)`
 * exactly like `StudioDock`'s own submit handler — a turn already in flight
 * (submitted/streaming) must not accept a second concurrent send from either
 * surface.
 */
export function AgentChatComposer() {
	const form = useForm<AgentComposerInput>({
		defaultValues: { prompt: "" },
		resolver: zodResolver(agentComposerInputSchema),
	});
	const prompt = form.watch("prompt") ?? "";
	const { sendMessage, status, stop } = useStudioChat();

	const onSubmit = form.handleSubmit((values) => {
		if (isChatWorking(status)) {
			return;
		}
		form.reset({ prompt: "" });
		// `useChat`'s own `onError` (studio-chat-provider.tsx) already toasts
		// and logs a failed turn — this catch exists ONLY so a rejected
		// `sendMessage()` promise never becomes an unhandled rejection (fix 2d).
		void sendMessage({ text: values.prompt }).catch(() => {});
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
		/>
	);
}
