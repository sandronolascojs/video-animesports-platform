// Shared director-discipline prompt fragments (AI-6a §8c, §8d) used by BOTH
// the plan agent (packages/ai/src/agents/plan.agent.ts) and the extend agent
// (packages/ai/src/agents/extend.agent.ts) — kept in one place so the two
// system prompts never drift on guidance that must be identical either way
// (duration direction, real-person casting).
import {
	DIALOGUE_WORDS_PER_SECOND,
	MAX_SCENE_DURATION_SECONDS,
	MIN_SCENE_DURATION_SECONDS,
} from "@video-platform-challenge/types";

/**
 * §8c: `durationSeconds` was schema-only guidance (int 4-15, zod) — the
 * agent had no PROSE direction on how to actually pick a value inside that
 * range, so real generations defaulted to one number for every scene. This
 * states the allowed range from the real `packages/types` constants (never
 * hardcoded) plus the editorial bands that make an episode's pacing read
 * like a real edit instead of a metronome.
 */
export function buildDurationDirectionGuidance(): string {
	return `Choose each scene's "durationSeconds" deliberately inside the allowed ${MIN_SCENE_DURATION_SECONDS}-${MAX_SCENE_DURATION_SECONDS}s range — never default to the same number for every scene: ${MIN_SCENE_DURATION_SECONDS}-6s for a single-impact beat (a glance, a gasp, a held reaction), 8-10s for a dialogue/action beat (the dialogue must physically fit: words ÷ ${DIALOGUE_WORDS_PER_SECOND} wps + about 1s of air before and after), 12-${MAX_SCENE_DURATION_SECONDS}s for a held emotional beat that needs room to breathe. Vary durations across the episode like a real director's shot list, not a fixed metronome.`;
}

/**
 * §8d (2b, user call 2026-07-12): a brief naming a real/famous person must
 * cast THAT person, verbatim name, never an invented substitute — applies to
 * both the plan agent (the brief itself may name someone real) and the
 * extend agent (a follow-up instruction can introduce one mid-story).
 */
export const REAL_PERSON_CASTING_DIRECTIVE =
	"If the story names a real, famous person (an athlete, a public figure — anyone a viewer would recognize by name), cast THEM: keep their real name exactly as given, and write their \"visualDescription\" as their recognizable real-world likeness translated into this show's anime style — their actual build, hair, skin tone, and any iconic kit/number/traits they're known for. Never swap a named real person for an invented character, and never rename them.";
