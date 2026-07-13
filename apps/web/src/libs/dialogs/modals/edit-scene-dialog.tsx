"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
	type UpdateSceneInput,
	updateSceneInputSchema,
} from "@video-platform-challenge/api";
import {
	MAX_SCENE_DURATION_SECONDS,
	MIN_SCENE_DURATION_SECONDS,
	SceneStatus,
} from "@video-platform-challenge/types";
import { CheckIcon, MinusIcon, PlusIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateScene } from "@/feature/studio/hooks/http/use-scenes";
import type { DialogPayloads } from "@/libs/dialogs/registry";
import { useDialog } from "@/libs/dialogs/use-dialog";
import { toast } from "@/libs/toast";

// `id` is supplied separately (from `payload.scene.id`), never a form field.
// `dialogue` (the locked, already-baked spoken line) is dropped from this
// form entirely (studio quality pass — compressed edit dialog): the only
// field a user can meaningfully act on for the caption is `subtitleText`,
// so the form exposes ONE "Dialogue" field that edits it. Everything else
// mirrors `updateSceneInputSchema` exactly, so the remaining constraints
// can never drift from what the server actually accepts.
const editSceneFormSchema = updateSceneInputSchema.omit({
	id: true,
	dialogue: true,
});
type EditSceneFormValues = z.infer<typeof editSceneFormSchema>;

/**
 * Studio quality pass: the scene row's ONLY editor. `title` is shown as the
 * dialog title, NOT a form field: `draft-store.ts`'s own doc comment is
 * explicit that `title` is agent-assigned and deliberately excluded from
 * `updateSceneInputSchema` — this dialog respects that instead of silently
 * growing the contract to make it editable.
 *
 * Compressed to 3 fields — Prompt, Dialogue, Duration. The old locked
 * spoken-`dialogue` textarea is gone; "Dialogue" here is `subtitleText`
 * (the on-screen caption, burned in at export) since that's the only piece
 * of dialogue a user can actually change post-generation.
 *
 * `durationSeconds` is disabled once the scene reaches `video_ready` —
 * mirrors `scenesContract.update`'s own doc comment
 * (packages/api/src/contracts/scenes.ts) and `isLockedSceneFieldEdit`
 * (apps/server/src/lib/scene-update-guard.ts): the clip's audio is already
 * baked in at that exact duration, so editing it here would just
 * round-trip into a CONFLICT toast. The locked field is omitted from the
 * save payload entirely (not merely left unchanged) — SENDING it at all is
 * what trips the guard, regardless of value. `prompt` and `subtitleText`
 * stay editable at every status (the guard never locks them).
 */
export function EditSceneDialog({
	payload,
}: {
	payload: DialogPayloads["edit-scene"];
}) {
	const { scene, projectId, onSaved } = payload;
	const { close } = useDialog();
	const updateScene = useUpdateScene(projectId);
	const isLocked = scene.status === SceneStatus.VIDEO_READY;

	const { control, handleSubmit, watch, setValue } =
		useForm<EditSceneFormValues>({
			resolver: zodResolver(editSceneFormSchema),
			defaultValues: {
				durationSeconds: scene.durationSeconds,
				prompt: scene.prompt,
				subtitleText: scene.subtitleText ?? "",
			},
		});
	const durationSeconds = watch("durationSeconds") ?? scene.durationSeconds;

	const onSubmit = handleSubmit((values) => {
		const patch: UpdateSceneInput = {
			id: scene.id,
			prompt: values.prompt,
			subtitleText: values.subtitleText,
			...(isLocked ? {} : { durationSeconds: values.durationSeconds }),
		};
		updateScene.mutate(patch, {
			onSuccess: (updated) => {
				onSaved(updated);
				toast.success({
					description: "Your changes have been saved.",
					icon: <CheckIcon className="size-4" />,
					title: "Scene updated",
				});
				close();
			},
		});
	});

	const adjustDuration = (delta: number) => {
		const next = Math.min(
			MAX_SCENE_DURATION_SECONDS,
			Math.max(MIN_SCENE_DURATION_SECONDS, durationSeconds + delta),
		);
		setValue("durationSeconds", next, { shouldValidate: true });
	};

	return (
		<Dialog open onOpenChange={(open) => !open && close()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{scene.title ?? "Untitled scene"}</DialogTitle>
					<DialogDescription>
						Edit this scene's prompt, dialogue, and duration.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
					<div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto py-0.5">
						<Controller
							control={control}
							name="prompt"
							render={({ field, fieldState }) => (
								<Field data-invalid={fieldState.invalid}>
									<FieldLabel htmlFor="edit-scene-prompt">Prompt</FieldLabel>
									<Textarea
										{...field}
										id="edit-scene-prompt"
										rows={5}
										className="min-h-0 resize-y"
										aria-invalid={fieldState.invalid}
									/>
									<FieldDescription>
										Feeds a future retry, never the already-generated clip.
									</FieldDescription>
									{fieldState.invalid && (
										<FieldError errors={[fieldState.error]} />
									)}
								</Field>
							)}
						/>

						<Controller
							control={control}
							name="subtitleText"
							render={({ field, fieldState }) => (
								<Field data-invalid={fieldState.invalid}>
									<FieldLabel htmlFor="edit-scene-dialogue">
										Dialogue
									</FieldLabel>
									<Textarea
										{...field}
										id="edit-scene-dialogue"
										rows={3}
										className="min-h-0 resize-y"
										aria-invalid={fieldState.invalid}
									/>
									<FieldDescription>
										On-screen caption, burned in at export.
									</FieldDescription>
									{fieldState.invalid && (
										<FieldError errors={[fieldState.error]} />
									)}
								</Field>
							)}
						/>

						<Field>
							<FieldLabel htmlFor="edit-scene-duration">Duration</FieldLabel>
							<div className="flex items-center gap-2">
								<Button
									type="button"
									variant="outline"
									size="icon-sm"
									disabled={
										isLocked || durationSeconds <= MIN_SCENE_DURATION_SECONDS
									}
									onClick={() => adjustDuration(-1)}
								>
									<MinusIcon className="size-3.5" />
									<span className="sr-only">Decrease duration</span>
								</Button>
								<Controller
									control={control}
									name="durationSeconds"
									render={({ field }) => (
										<Input
											id="edit-scene-duration"
											type="number"
											min={MIN_SCENE_DURATION_SECONDS}
											max={MAX_SCENE_DURATION_SECONDS}
											disabled={isLocked}
											className="w-16 text-center"
											value={field.value ?? scene.durationSeconds}
											onChange={(event) => {
												const parsed = Number(event.target.value);
												if (Number.isFinite(parsed)) {
													field.onChange(parsed);
												}
											}}
										/>
									)}
								/>
								<Button
									type="button"
									variant="outline"
									size="icon-sm"
									disabled={
										isLocked || durationSeconds >= MAX_SCENE_DURATION_SECONDS
									}
									onClick={() => adjustDuration(1)}
								>
									<PlusIcon className="size-3.5" />
									<span className="sr-only">Increase duration</span>
								</Button>
								<span className="text-muted-foreground text-xs">
									sec ({MIN_SCENE_DURATION_SECONDS}-{MAX_SCENE_DURATION_SECONDS}
									)
								</span>
							</div>
							{isLocked ? (
								<FieldDescription>
									Locked — baked into this clip's audio. Retry to change.
								</FieldDescription>
							) : null}
						</Field>
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => close()}>
							Cancel
						</Button>
						<Button type="submit" disabled={updateScene.isPending}>
							{updateScene.isPending ? <Spinner /> : null}
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
