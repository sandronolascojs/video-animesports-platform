import type { Scene } from "@video-platform-challenge/api";

/**
 * Global typed dialog registry (docs/studio-ui.md "Dialog system rule"):
 * every modal key maps to its typed payload here — opening a modal with the
 * wrong payload shape is a compile error. `onConfirm`/`onSaved` (rather than
 * raw ids alone) is deliberate: the store/action a dialog needs to call often
 * lives in a component-scoped store (e.g. Studio's per-project draft store),
 * not something the globally-mounted `DialogProvider` can reach on its own —
 * the opening component closes over its own store action instead.
 *
 * New modal = add a key here + a lazy component entry in `dialog-provider.tsx`.
 */
export type DialogPayloads = {
	"delete-scene": {
		sceneId: string;
		title: string;
		onConfirm: () => void;
	};
	/**
	 * Studio quality pass §2b: the scene row's ONLY editor now (the old
	 * inline prompt/dialogue/subtitle expand under the row is gone) — `scene`
	 * is a snapshot at open-time (edits are explicit Save, not live-typed
	 * into the draft store), `onSaved` lets the opener (`ScenesPanel`) patch
	 * its own draft store immediately on a successful save instead of waiting
	 * for the next poll.
	 */
	"edit-scene": {
		scene: Scene;
		projectId: string;
		onSaved: (scene: Scene) => void;
	};
};

export type DialogKey = keyof DialogPayloads;
