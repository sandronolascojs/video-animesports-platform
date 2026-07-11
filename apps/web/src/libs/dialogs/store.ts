"use client";

import { create } from "zustand";

import type { DialogKey, DialogPayloads } from "@/libs/dialogs/registry";

type DialogStoreState = {
	key: DialogKey | null;
	payload: DialogPayloads[DialogKey] | null;
	open: <K extends DialogKey>(key: K, payload: DialogPayloads[K]) => void;
	close: () => void;
};

/**
 * The one global dialog store (docs/studio-ui.md "Dialog system rule") —
 * app-wide client state, so it's zustand like everything else, not a
 * component-local `useState`. Only one dialog is open at a time in v1.
 */
export const useDialogStore = create<DialogStoreState>((set) => ({
	close: () => set({ key: null, payload: null }),
	key: null,
	open: (key, payload) => set({ key, payload }),
	payload: null,
}));
