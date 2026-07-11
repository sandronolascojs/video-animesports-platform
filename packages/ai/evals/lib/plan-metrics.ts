import type { AudioLanguage as AudioLanguageType } from "@video-platform-challenge/types";
import {
	AudioLanguage,
	DIALOGUE_WORDS_PER_SECOND,
	MAX_SCENE_DURATION_SECONDS,
	MIN_SCENE_DURATION_SECONDS,
} from "@video-platform-challenge/types";

export interface MetricResult {
	score: number;
	metadata: Record<string, unknown>;
}

export interface SceneLike {
	dialogue: string;
	speaker: string | null;
	durationSeconds: number;
}

/**
 * Duration quality: every value must be an integer inside the allowed
 * MIN..MAX range (hard fail to 0 otherwise). With `requireVariety` (plan
 * suite, sceneCount >= 3) a valid-but-uniform set scores 0.5 — the exact
 * "metronome pacing" regression the §8c duration-direction prompt guidance
 * exists to prevent.
 */
export function scoreDurations(
	durations: number[],
	options: { requireVariety: boolean },
): MetricResult {
	const outOfBounds = durations.filter(
		(duration) =>
			!Number.isInteger(duration) ||
			duration < MIN_SCENE_DURATION_SECONDS ||
			duration > MAX_SCENE_DURATION_SECONDS,
	);
	if (outOfBounds.length > 0) {
		return { score: 0, metadata: { durations, outOfBounds } };
	}
	const distinctCount = new Set(durations).size;
	if (options.requireVariety && distinctCount < 2) {
		return {
			score: 0.5,
			metadata: { durations, reason: "valid range but uniform (metronome)" },
		};
	}
	return { score: 1, metadata: { durations, distinctCount } };
}

/**
 * Spoken-length proxy for a dialogue line. Japanese is written without
 * spaces, so a whitespace word count is meaningless there — use character
 * count / 5 as the word-equivalent proxy (≈ one English-word of speaking
 * time per ~5 Japanese characters), consistent with the system prompt's own
 * "noticeably shorter phrasing in Japanese" guidance.
 */
export function dialogueWordCount(
	dialogue: string,
	audioLanguage: AudioLanguageType,
): number {
	if (audioLanguage === AudioLanguage.JAPANESE) {
		return Math.ceil(dialogue.replace(/\s/g, "").length / 5);
	}
	return dialogue.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Dialogue budget (§8c): a line must be comfortably speakable inside its
 * scene — words / DIALOGUE_WORDS_PER_SECOND + 1s of air must fit
 * `durationSeconds`. Score = fraction of dialogue-carrying scenes that fit;
 * silent scenes are a valid anime beat and are skipped.
 */
export function scoreDialogueBudget(
	scenes: SceneLike[],
	audioLanguage: AudioLanguageType,
): MetricResult {
	const spoken = scenes.filter((scene) => scene.dialogue.trim().length > 0);
	if (spoken.length === 0) {
		return { score: 1, metadata: { skipped: "all scenes silent" } };
	}
	const overBudget: Array<Record<string, unknown>> = [];
	for (const scene of spoken) {
		const words = dialogueWordCount(scene.dialogue, audioLanguage);
		const secondsNeeded = words / DIALOGUE_WORDS_PER_SECOND + 1;
		if (secondsNeeded > scene.durationSeconds) {
			overBudget.push({
				dialogue: scene.dialogue,
				words,
				secondsNeeded: Number(secondsNeeded.toFixed(1)),
				durationSeconds: scene.durationSeconds,
			});
		}
	}
	return {
		score: (spoken.length - overBudget.length) / spoken.length,
		metadata: { spokenScenes: spoken.length, overBudget },
	};
}

/** Speaker validity: every scene's speaker is null (silent) or EXACTLY one
 * of the plan's character names. Score = fraction of scenes valid. */
export function scoreSpeakerValidity(
	scenes: SceneLike[],
	validNames: string[],
): MetricResult {
	if (scenes.length === 0) {
		return { score: 0, metadata: { reason: "no scenes" } };
	}
	const invalid = scenes
		.filter(
			(scene) => scene.speaker !== null && !validNames.includes(scene.speaker),
		)
		.map((scene) => scene.speaker);
	return {
		score: (scenes.length - invalid.length) / scenes.length,
		metadata: { validNames, invalidSpeakers: invalid },
	};
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * One keyword group = `a|b|c` alternates; the group matches when ANY
 * alternate is found. Short alternates (<= 4 chars, e.g. "mom", "shy") are
 * matched as word-boundary PREFIXES so "moment" never satisfies "mom";
 * longer alternates match as plain substrings so stems cover inflections
 * ("penalt" → penalty/penalties, "bribe" → bribed/bribery). All matching is
 * case-insensitive.
 */
export function matchesKeywordGroup(haystack: string, group: string): boolean {
	return group.split("|").some((alternate) => {
		const needle = alternate.trim();
		if (needle.length === 0) {
			return false;
		}
		if (needle.length <= 4) {
			return new RegExp(`\\b${escapeRegExp(needle)}`, "iu").test(haystack);
		}
		return haystack.toLowerCase().includes(needle.toLowerCase());
	});
}

/** Premise retention: fraction of expected keyword groups found anywhere in
 * the serialized plan (synopsis, prompts, dialogue, descriptions...). */
export function scoreKeywordGroups(
	planJson: string,
	groups: string[],
): MetricResult {
	if (groups.length === 0) {
		return { score: 1, metadata: { skipped: true } };
	}
	const missing = groups.filter(
		(group) => !matchesKeywordGroup(planJson, group),
	);
	return {
		score: (groups.length - missing.length) / groups.length,
		metadata: { groups, missing },
	};
}

/** Hiragana / katakana / CJK unified (+ ext A) ranges — "is there Japanese
 * script in this string" for the dialogue-language scorer. */
export function containsJapaneseScript(text: string): boolean {
	return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u.test(text);
}
