"use client";

import { useDialogStore } from "@/libs/dialogs/store";

/**
 * Typed dialog hook (docs/studio-ui.md "Dialog system rule") — the only way
 * app code should open/close a modal. `open` stays generic over
 * `DialogPayloads`, so `useDialog().open("delete-scene", { wrongField: 1 })`
 * is a compile error, not a runtime surprise.
 */
export function useDialog() {
	const open = useDialogStore((state) => state.open);
	const close = useDialogStore((state) => state.close);
	return { close, open };
}
