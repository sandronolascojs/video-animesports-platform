"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { DialogPayloads } from "@/libs/dialogs/registry";
import { useDialog } from "@/libs/dialogs/use-dialog";

/**
 * Confirms permanently deleting a whole project (sidebar "Recent" row action).
 * Mirrors `DeleteSceneDialog`: this component only CLOSES on confirm and
 * delegates the actual work to `payload.onConfirm` (the caller's delete
 * mutation) so it stays decoupled from where the project lives. The
 * success/error toasts live in that mutation, never fired synchronously here —
 * a failed delete must not flash a "Deleted" toast. Unlike a scene delete this
 * is irreversible (no Ctrl+Z) and cascades the project's assets from R2, so the
 * confirm button carries destructive styling.
 */
export function DeleteProjectDialog({
	payload,
}: {
	payload: DialogPayloads["delete-project"];
}) {
	const { close } = useDialog();

	return (
		<AlertDialog open onOpenChange={(open) => !open && close()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete "{payload.title}"?</AlertDialogTitle>
					<AlertDialogDescription>
						This permanently deletes the project and every file it generated.
						This can't be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						onClick={() => {
							payload.onConfirm();
							close();
						}}
					>
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
