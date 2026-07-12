"use client";

import type { ProjectDetail } from "@video-platform-challenge/api";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { useStore } from "zustand";
import { useProject } from "@/feature/studio/hooks/http/use-project";
import { useDraftPersistence } from "@/feature/studio/hooks/use-draft-persistence";
import {
	createDraftStore,
	type DraftStore,
	type DraftStoreState,
} from "@/feature/studio/stores/draft-store";
import { useShortcut } from "@/hooks/use-platform";

const DraftStoreContext = createContext<DraftStore | null>(null);

export type DraftStoreProviderProps = {
	projectId: string;
	initialDetail: ProjectDetail;
	children: ReactNode;
};

/**
 * Keeps the draft store's reconcile side in sync with the polled
 * `projects.get` query (docs' generating-state polling + reconcile rule —
 * see draft-store.ts's `applyServerSnapshot` doc comment). Takes `store` as a
 * prop (zustand's `useStore`, not the context hook) so it can render as a
 * child of `DraftStoreContext.Provider` without importing the context
 * indirection just for this one effect.
 */
function ProjectSync({
	store,
	projectId,
}: {
	store: DraftStore;
	projectId: string;
}) {
	const { data } = useProject(projectId);
	const applyServerSnapshot = useStore(
		store,
		(state) => state.applyServerSnapshot,
	);

	useEffect(() => {
		if (data) {
			applyServerSnapshot(data);
		}
	}, [data, applyServerSnapshot]);

	return null;
}

/**
 * Instantiates one `DraftStore` per Studio project (docs/studio-ui.md
 * "Client state rule"), wires the global Ctrl+Z / Ctrl+Shift+Z undo/redo
 * shortcut, and mounts the two effect-only children that keep it wired to
 * the server: `ProjectSync` (poll → store) and `useDraftPersistence` (store
 * → debounced save). `initialDetail` comes from the Studio page's SSR fetch
 * so the store — and the first paint — never starts empty.
 */
export function DraftStoreProvider({
	projectId,
	initialDetail,
	children,
}: DraftStoreProviderProps) {
	const [store] = useState(() => createDraftStore(initialDetail));
	// `useShortcut`'s shared listener calls `event.preventDefault()` before
	// invoking any handler, so an editable-target check *inside* the handler
	// can't stop it from swallowing native text-undo — the shortcut has to be
	// unregistered (via `enabled: false`) while focus is in a text field
	// instead, which needs this focus-tracking state.
	const [isEditableFocused, setIsEditableFocused] = useState(false);

	useEffect(() => {
		function isEditableElement(target: EventTarget | null): boolean {
			const element = target as HTMLElement | null;
			return (
				element?.tagName === "INPUT" ||
				element?.tagName === "TEXTAREA" ||
				Boolean(element?.isContentEditable)
			);
		}
		function onFocusIn(event: FocusEvent) {
			setIsEditableFocused(isEditableElement(event.target));
		}
		function onFocusOut() {
			setIsEditableFocused(false);
		}
		window.addEventListener("focusin", onFocusIn);
		window.addEventListener("focusout", onFocusOut);
		return () => {
			window.removeEventListener("focusin", onFocusIn);
			window.removeEventListener("focusout", onFocusOut);
		};
	}, []);

	useShortcut("z", () => store.getState().undo(), {
		allowRepeat: true,
		enabled: !isEditableFocused,
	});
	useShortcut("shift+z", () => store.getState().redo(), {
		allowRepeat: true,
		enabled: !isEditableFocused,
	});

	return (
		<DraftStoreContext.Provider value={store}>
			<ProjectSync store={store} projectId={projectId} />
			<PersistenceSync store={store} projectId={projectId} />
			{children}
		</DraftStoreContext.Provider>
	);
}

function PersistenceSync({
	store,
	projectId,
}: {
	store: DraftStore;
	projectId: string;
}) {
	useDraftPersistence(store, projectId);
	return null;
}

/** Scoped store accessor — throws outside a `DraftStoreProvider` (Studio only). */
export function useDraftStore<T>(selector: (state: DraftStoreState) => T): T {
	const store = useContext(DraftStoreContext);
	if (!store) {
		throw new Error("useDraftStore must be used within a DraftStoreProvider");
	}
	return useStore(store, selector);
}
