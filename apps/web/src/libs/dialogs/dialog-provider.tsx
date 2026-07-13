"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

import type { DialogKey } from "@/libs/dialogs/registry";
import { useDialogStore } from "@/libs/dialogs/store";

/**
 * Every modal is lazy-loaded (`next/dynamic`) and keyed by its
 * `DialogPayloads` key (docs/studio-ui.md "Dialog system rule") — adding a
 * dialog is "add a registry key + one entry here," and nothing is bundled
 * or mounted until `useDialog().open(...)` is actually called.
 *
 * `payload: never` is deliberate: it's what makes a component whose real
 * payload prop is `DialogPayloads[K]` (narrower than the union) assignable
 * into this map (function parameters are contravariant, and `never` is
 * assignable to everything). It's a one-time, well-known TS trick for
 * heterogeneous keyed component registries — see the single cast in
 * `DialogProvider` below, which is the only place it leaks out.
 */
const DIALOG_COMPONENTS: Record<
	DialogKey,
	ComponentType<{ payload: never }>
> = {
	"delete-scene": dynamic(() =>
		import("@/libs/dialogs/modals/delete-scene-dialog").then(
			(mod) => mod.DeleteSceneDialog,
		),
	),
	"delete-project": dynamic(() =>
		import("@/libs/dialogs/modals/delete-project-dialog").then(
			(mod) => mod.DeleteProjectDialog,
		),
	),
	"edit-scene": dynamic(() =>
		import("@/libs/dialogs/modals/edit-scene-dialog").then(
			(mod) => mod.EditSceneDialog,
		),
	),
};

/**
 * Global dialog host — mounted once in the root layout providers. Renders
 * the active modal only while a dialog is open; nothing else. No inline
 * `useState` dialogs anywhere else in the app.
 */
export function DialogProvider() {
	const dialogKey = useDialogStore((state) => state.key);
	const payload = useDialogStore((state) => state.payload);

	if (!dialogKey || !payload) {
		return null;
	}

	const DialogComponent = DIALOG_COMPONENTS[dialogKey];
	// See the `payload: never` note above — the registry can't correlate
	// `dialogKey` and `payload` through the Record's value type, so this is
	// the one documented escape hatch. `useDialog().open()` stays fully typed.
	return <DialogComponent payload={payload as never} />;
}
