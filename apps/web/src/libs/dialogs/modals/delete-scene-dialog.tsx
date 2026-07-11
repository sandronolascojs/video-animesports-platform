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
 * v1's only modal (docs/studio-ui.md "Dialog system rule"): confirms
 * deleting a scene from the Studio draft timeline. Rendered by
 * `DialogProvider` only while open; `payload.onConfirm` is the caller's own
 * store action (see registry.ts) so this component stays decoupled from
 * where the scene actually lives.
 *
 * Batch C fix 5: this dialog only ever CLOSES on confirm now — it used to
 * fire a synchronous "Deleted" success toast right here, before
 * `payload.onConfirm()`'s actual `removeScene` mutation had resolved. A
 * failed mutation then showed a contradictory "Deleted" + "Couldn't remove"
 * toast pair while the scene was still sitting right there in the list. The
 * success toast now lives in the mutation's own `onSuccess`
 * (`scenes-panel.tsx`), the ONE place that actually knows the delete
 * succeeded; the mutation's existing `onError` (`use-scenes.ts`) still
 * covers failure.
 */
export function DeleteSceneDialog({
	payload,
}: {
	payload: DialogPayloads["delete-scene"];
}) {
	const { close } = useDialog();

	return (
		<AlertDialog open onOpenChange={(open) => !open && close()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete "{payload.title}"?</AlertDialogTitle>
					<AlertDialogDescription>
						This removes the scene from the draft timeline. Undo with Ctrl+Z if
						you change your mind.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
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
