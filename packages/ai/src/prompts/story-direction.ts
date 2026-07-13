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
	return `Choose each scene's "durationSeconds" from the ONE physical action it contains — bias SHORT, like a real anime edit; a scene that overstays its beat reads as padded and slow. Reason per scene: what single action happens, and how long does that action actually take on screen? Bands: ${MIN_SCENE_DURATION_SECONDS}-5s is the DEFAULT for a single decisive beat (a kick, a save, a shout, a glance, a reaction) — most scenes live here; 6-8s only when a line of dialogue must physically fit (words ÷ ${DIALOGUE_WORDS_PER_SECOND} wps + ~1s of air before/after) or two quick actions chain; 9-${MAX_SCENE_DURATION_SECONDS}s is RARE and reserved for a single climactic held moment (the goal landing, the final embrace) — never use it for an ordinary run, celebration, or transition, and only if the beat genuinely needs the extra time. A celebration or a coach running to hug is 5-7s, not 12. Never pad to fill time and never default every scene to the same number — vary durations to the action, like a director's shot list.`;
}

/**
 * §8d (2b, user call 2026-07-12): a brief naming a real/famous person must
 * cast THAT person, verbatim name, never an invented substitute — applies to
 * both the plan agent (the brief itself may name someone real) and the
 * extend agent (a follow-up instruction can introduce one mid-story).
 */
export const REAL_PERSON_CASTING_DIRECTIVE =
	'If the story names a real, famous person (an athlete, a public figure — anyone a viewer would recognize by name), cast THEM: keep their real name exactly as given, and write their "visualDescription" as an ANIME CHARACTER that reads as the anime version of them — a 2D cel-shaded anime drawing in this show\'s exact style, never a photograph, never a photoreal or 3D render. Lead the description with the anime rendering ("a 2D cel-anime character with…"), THEN their recognizable traits redrawn as anime: their build, hairstyle, skin tone, and any iconic kit/number/traits, all stylized into clean anime lineart and cel shading. The likeness must be recognizable, but the medium is unmistakably anime — if it could be mistaken for a photo of the real person, it is wrong. Never swap a named real person for an invented character, and never rename them.';
