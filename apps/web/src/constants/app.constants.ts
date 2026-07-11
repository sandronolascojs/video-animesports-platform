// App-wide constant values that aren't tied to a single feature — window
// event names, cross-cutting keys, etc. Feature-scoped constants stay in
// their own `feature/{featurename}/` folder; this file is only for values
// shared across features/components.

/**
 * Window `CustomEvent` name the sidebar's "New project" pill dispatches when
 * the current route is Home (docs/ai-architecture-v1.md §1): `HomeView`
 * listens for it and bumps its own `focusSignal` state to imperatively focus
 * the hero composer. Centralized here (rather than a string literal on both
 * ends) so the two sides can never drift.
 */
export const FOCUS_COMPOSER_EVENT = "zenkai:focus-composer";
