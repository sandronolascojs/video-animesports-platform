/**
 * Global typed dialog registry (docs/studio-ui.md "Dialog system rule"):
 * every modal key maps to its typed payload here — opening a modal with the
 * wrong payload shape is a compile error. `onConfirm` (rather than raw ids
 * alone) is deliberate: the store/action a confirm dialog needs to call
 * often lives in a component-scoped store (e.g. Studio's per-project draft
 * store), not something the globally-mounted `DialogProvider` can reach on
 * its own — the opening component closes over its own store action instead.
 *
 * New modal = add a key here + a lazy component entry in `dialog-provider.tsx`.
 */
export type DialogPayloads = {
	"delete-scene": {
		sceneId: string;
		title: string;
		onConfirm: () => void;
	};
};

export type DialogKey = keyof DialogPayloads;
