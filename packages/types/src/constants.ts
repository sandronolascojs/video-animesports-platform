import type { AudioLanguage, CharacterGender } from "./enums";

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

// ElevenLabs premade voice ids, one per audioLanguage (architecture/
// v2-voice-pipeline: dialogue is lip-synced in-clip via Seedance's
// `reference_audio_urls`, so the TTS voice now matters per-language, not just
// as a single global default). Premade voice ids are stable across
// ElevenLabs accounts. MVP still uses one voice per language project-wide
// (no per-character voices yet — v-next refinement, docs §5b). Tunable in
// one place after the first real run.
export const TTS_VOICE_BY_LANGUAGE = {
	ja: "pNInz6obpgDQGcFmaJgB", // ElevenLabs premade "Adam" — energetic male, strong for shonen JA dialogue via multilingual v2
	en: "TxGEqnHWrfWFTfGW9XjX", // ElevenLabs premade "Josh" — deep male, natural EN delivery
} as const satisfies Record<AudioLanguage, string>;

// Per-language, per-gender ElevenLabs premade voice pools (docs §5b voice
// pipeline). All are multilingual-v2 premades — the same voice speaks JA or
// EN natively; the per-language split lets each language curate the voices
// whose delivery fits it best. A character's voice is FIXED per character
// (deterministic pick, see `pickCharacterVoice`) — same character, same
// voice, every scene and every re-run.
export const VOICE_POOLS = {
	ja: {
		male: [
			"pNInz6obpgDQGcFmaJgB", // Adam — energetic, shonen protagonist register
			"ErXwobaYiN019PkySvjV", // Antoni — warm mid-range, senpai register
			"nPczCjzI2devNBz1zQrb", // Brian — low and steady, coach/rival register
		],
		female: [
			"21m00Tcm4TlvDq8ikWAM", // Rachel — clear and bright
			"XrExE9yKIg1WjnnlVkGX", // Matilda — soft, younger register
			"Xb7hH8MSUJpSbSDYk0k2", // Alice — composed, announcer/manager register
		],
	},
	en: {
		male: [
			"TxGEqnHWrfWFTfGW9XjX", // Josh — deep, natural EN delivery
			"onwK4e9ZLuTAKqWW03F9", // Daniel — broadcast-clean
			"TX3LPaxmHKxFdv7VOQHJ", // Liam — youthful energy
		],
		female: [
			"EXAVITQu4vr4xnSDxMaL", // Sarah — warm and confident
			"cgSgspJ2msm6clMCkdW9", // Jessica — bright, expressive
			"pFZP5JQG7iQjIQuC4Bku", // Lily — light, younger register
		],
	},
} as const satisfies Record<
	AudioLanguage,
	Record<CharacterGender, readonly string[]>
>;

/**
 * Deterministic "random" voice casting: hash(projectId:characterName) picks
 * from the language+gender pool, so the assignment is stable for the whole
 * project (fixed per character — user rule) without storing anything, while
 * different characters/projects land on different voices.
 */
export function pickCharacterVoice(args: {
	projectId: string;
	characterName: string;
	gender: CharacterGender;
	language: AudioLanguage;
}): string {
	const pool = VOICE_POOLS[args.language][args.gender];
	const seed = `${args.projectId}:${args.characterName}`;
	let hash = 5381;
	for (let i = 0; i < seed.length; i++) {
		hash = (hash * 33) ^ seed.charCodeAt(i);
	}
	// noUncheckedIndexedAccess appeasement — the modulo is always in range.
	return (
		pool[Math.abs(hash) % pool.length] ?? TTS_VOICE_BY_LANGUAGE[args.language]
	);
}

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
