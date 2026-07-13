// The first generation always produces exactly 3 scenes (fast, cheap first
// feedback). Extending the story afterwards adds one scene at a time.
export const INITIAL_SCENE_COUNT = 3;

// Seedance scene duration bounds (int seconds), enforced by the API layer's
// zod schema. See docs/video-engine-architecture.md §3, §7.
export const MIN_SCENE_DURATION_SECONDS = 4;
export const MAX_SCENE_DURATION_SECONDS = 15;

// Keyframe fencing: for N scenes we generate N + KEYFRAME_COUNT_OFFSET
// keyframes (K1…KN+1) so every scene has a first AND last frame anchor.
// See docs/video-engine-architecture.md §2.
export const KEYFRAME_COUNT_OFFSET = 1;

export const MIN_SCENES_PER_GENERATION = 1;
export const MAX_SCENES_PER_GENERATION = 10;

export const MAX_RENDER_UPLOAD_SIZE_BYTES = 500 * 1024 * 1024;

// A `project_versions` row stuck in `rendering` older than this is treated as
export const RENDER_ABANDON_MINUTES = 20;

// Mirrors RENDER_ABANDON_MINUTES for `projects` rows: a project stuck
// non-terminal (`planning`/`generating`) older than this is treated as
// abandoned and reclaimable by extend/retry (e.g. the isolate running its
// workflow was killed before the run-level catch-all ever marked it
// failed) — without this, a wedged project's terminal-status guard was a
// permanent dead end. See apps/server/src/lib/project-reclaim.ts.
export const GENERATION_ABANDON_MINUTES = 30;

export const MAX_PROJECTS_PER_HOUR = 5;
export const MAX_GENERATION_KICKS_PER_HOUR = 20;
// A render is real work (an R1 browser Mediabunny remux round trip) even
// though it isn't billed kie.ai spend like the other MAX_*_PER_HOUR
// counters — bounded so a client retry loop can't spin it unbounded.
export const MAX_RENDERS_PER_HOUR = 20;

export const MAX_AGENT_TURNS_PER_HOUR = 30;

export const DIALOGUE_WORDS_PER_SECOND = 2.5;
