"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
	type CreateProjectFormInput,
	type CreateProjectInput,
	createProjectInputSchema,
} from "@video-platform-challenge/api";
import {
	AudioLanguage,
	INITIAL_SCENE_COUNT,
	SubtitleLanguage,
	TemplateKey,
} from "@video-platform-challenge/types";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useState } from "react";
import { useForm } from "react-hook-form";

import { AIDockInput } from "@/components/app/ai-dock";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ComposerToolbar } from "@/feature/home/components/composer-toolbar";
import { useCreateProject } from "@/feature/home/hooks/http/use-projects";
import { SPORT_TEMPLATES } from "@/feature/home/sport-templates";

const MODAL_PLACEHOLDERS = SPORT_TEMPLATES.map(
	(template) => template.examplePrompt,
);

// Identical defaults to HomeView's hero composer (docs/ai-architecture-v1.md
// §1: "Submit = same shared createProjectInputSchema + useCreateProject
// flow"). Extracted to a constant (rather than inlined once, like HomeView
// does) because this form needs to reset back to it every time the modal
// closes, not just on mount.
const DEFAULT_VALUES: CreateProjectFormInput = {
	aspectRatio: "16:9",
	audioLanguage: AudioLanguage.JAPANESE,
	description: "",
	sceneCount: INITIAL_SCENE_COUNT,
	subtitleLanguage: SubtitleLanguage.ENGLISH,
	templateKey: TemplateKey.SOCCER,
};

type CreateProjectModalContextValue = {
	/**
	 * Opens the create-project modal from ANYWHERE (docs/ai-architecture-v1.md
	 * §1: sidebar "New project" pill, future empty states/palette actions).
	 * Home keeps its own hero composer instead (dispatches
	 * `FOCUS_COMPOSER_EVENT`) — callers branch on route before calling this.
	 */
	open: () => void;
};

const CreateProjectModalContext =
	createContext<CreateProjectModalContextValue | null>(null);

export function useCreateProjectModal(): CreateProjectModalContextValue {
	const context = useContext(CreateProjectModalContext);
	if (!context) {
		throw new Error(
			"useCreateProjectModal must be used within CreateProjectModalProvider",
		);
	}
	return context;
}

/**
 * App-wide "create project" surface (docs/ai-architecture-v1.md §1 "Create
 * surface rework"): a `Dialog` that is visually NOT a dialog — no header, no
 * footer, no close button, transparent shell — ONLY the glass `AIDockInput`
 * ("hero" mode, the same surface `HomeView` renders) + `ComposerToolbar`
 * floating over the scrim. Mounted once in `components/providers.tsx` so
 * `useCreateProjectModal().open()` is reachable from anywhere in the private
 * shell, replacing `CreateDockProvider`/`GlobalCreateDock`.
 *
 * Same form contract as `HomeView`'s hero composer: shared
 * `createProjectInputSchema` + `useCreateProject` + `router.push` on success
 * — this IS the Home flow, just rendered in a modal shell instead of the
 * page. Escape/scrim-click close the dialog (Radix default, uncustomized);
 * the form resets back to `DEFAULT_VALUES` whenever the dialog closes, by
 * any means, so a stale draft never leaks into the next open.
 */
export function CreateProjectModalProvider({
	children,
}: {
	children: ReactNode;
}) {
	const router = useRouter();
	const createProject = useCreateProject();

	const [isOpen, setIsOpen] = useState(false);
	// Bumped by `open()` so `AIDockInput` focuses its textarea on every open
	// (the dock's `focusSignal` prop) — `undefined` never force-focuses, same
	// sentinel convention `AIDockInput`/`AIDock` already use elsewhere.
	const [focusSignal, setFocusSignal] = useState<number | undefined>(undefined);

	// Three explicit generics (input, context, output): `sceneCount`'s zod
	// `.default()` splits the schema's input type (optional) from its output
	// (required number) — same reasoning as HomeView's identical form.
	const { watch, setValue, handleSubmit, reset } = useForm<
		CreateProjectFormInput,
		unknown,
		CreateProjectInput
	>({
		defaultValues: DEFAULT_VALUES,
		resolver: zodResolver(createProjectInputSchema),
	});
	const description = watch("description");
	const aspectRatio = watch("aspectRatio");
	const audioLanguage = watch("audioLanguage");
	const subtitleLanguage = watch("subtitleLanguage");
	// `?? INITIAL_SCENE_COUNT` narrows the input-side optionality — the
	// defaultValues above guarantee a value at runtime.
	const sceneCount = watch("sceneCount") ?? INITIAL_SCENE_COUNT;

	const open = () => {
		setIsOpen(true);
		setFocusSignal((count) => (count ?? 0) + 1);
	};

	const onOpenChange = (next: boolean) => {
		setIsOpen(next);
		if (!next) {
			reset(DEFAULT_VALUES);
		}
	};

	const onSubmit = handleSubmit((values) => {
		// M3 fix: double-submit guard — mirrors HomeView's identical hero
		// composer (the same create flow, just rendered in a modal shell).
		if (createProject.isPending) {
			return;
		}
		createProject.mutate(values, {
			onSuccess: (summary) => {
				setIsOpen(false);
				reset(DEFAULT_VALUES);
				router.push(`/projects/${summary.id}`);
			},
		});
	});

	return (
		<CreateProjectModalContext.Provider value={{ open }}>
			{children}
			<Dialog open={isOpen} onOpenChange={onOpenChange}>
				{/*
				 * Chromeless by design (docs §1: "visually NOT a dialog"):
				 * `showCloseButton={false}` drops the X, no `DialogHeader`/
				 * `DialogFooter` are rendered, and the override classes strip the
				 * popover surface (`bg-transparent`), the card ring
				 * (`ring-0` — zero width makes the paired ring color moot), and the
				 * default padding/gap (`p-0 gap-0`) so only `AIDockInput`'s own
				 * `glass-composer` shell is visible, floating over the
				 * `DialogOverlay` scrim. `max-w-2xl`/`sm:max-w-2xl` match the width
				 * of Home's hero composer wrapper exactly. `aria-describedby`
				 * cleared + an `sr-only` `DialogTitle` follow this repo's existing
				 * chromeless-dialog precedent (`ai-elements/model-selector.tsx`'s
				 * `ModelSelectorContent`) so the dialog stays accessible without
				 * showing visible chrome.
				 */}
				<DialogContent
					aria-describedby={undefined}
					showCloseButton={false}
					className="max-w-2xl gap-0 bg-transparent p-0 ring-0 sm:max-w-2xl"
				>
					<DialogTitle className="sr-only">Create project</DialogTitle>
					<AIDockInput
						mode="hero"
						value={description}
						onChange={(next) => setValue("description", next)}
						onSubmit={onSubmit}
						placeholders={MODAL_PLACEHOLDERS}
						focusSignal={focusSignal}
						status={createProject.isPending ? "submitted" : undefined}
						leftToolbar={
							<ComposerToolbar
								aspectRatio={aspectRatio}
								onAspectRatioChange={(next) => setValue("aspectRatio", next)}
								voiceLanguage={audioLanguage}
								onVoiceLanguageChange={(next) =>
									setValue("audioLanguage", next)
								}
								subtitleLanguage={subtitleLanguage}
								onSubtitleLanguageChange={(next) =>
									setValue("subtitleLanguage", next)
								}
								sceneCount={sceneCount}
								onSceneCountChange={(next) => setValue("sceneCount", next)}
							/>
						}
					/>
				</DialogContent>
			</Dialog>
		</CreateProjectModalContext.Provider>
	);
}
