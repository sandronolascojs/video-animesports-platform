// Pure compiler: `StyleBibleSpec` (the plan agent's structured art-direction
// output, docs architecture/v2-prompt-craft) -> the canonical text block
// prepended to EVERY downstream image/video prompt. Imports nothing from
// db/env/kie/cloudflare:workers, mirroring fail-reason.ts/timeline.ts's
// "pure, DB-free logic lives in lib/ so bun:test can import it directly"
// pattern (see fail-reason.ts's own doc comment for why that constraint
// exists — apps/server's services transitively import cloudflare:workers).
import type { StyleBibleSpec } from "@video-platform-challenge/types";

/**
 * Appended verbatim to every compiled style block — the hard consistency
 * clause the whole v2 prompt-craft upgrade exists to enforce ("100% igual a
 * un animé, misma coherencia visual" — every generation call, sheets,
 * keyframes, and video, must see this same anchor text). A constant, never
 * agent-authored: letting the LLM paraphrase it would reintroduce the drift
 * this clause exists to kill.
 */
export const ANIME_CONSISTENCY_CLAUSE =
	"Single anime episode aesthetic: same studio, same character designs, same palette, same line weight in every shot. Never reinterpret or restyle. 2D cel anime only — no 3D render, no photorealism, no live action. No text, no captions, no subtitles, no watermarks, no logos anywhere in the frame.";

/**
 * Deterministically compiles a `StyleBibleSpec` into the canonical style
 * block. Field order is fixed and labeled so every downstream prompt reads
 * the same structure regardless of which template/story produced the spec.
 * Persisted verbatim into `projects.styleBible` (still a plain string
 * column — docs §6, Workflows' Rpc.Serializable constraint) by
 * generation.service.ts's `runPlanStep`.
 */
export function compileStyleBible(spec: StyleBibleSpec): string {
	return [
		`Art direction: ${spec.artDirection}`,
		`Line art: ${spec.lineArt}`,
		`Color script: ${spec.colorScript}`,
		`Character rendering: ${spec.characterRendering}`,
		`Lighting: ${spec.lighting}`,
		`Camera grammar: ${spec.cameraGrammar}`,
		`Film texture: ${spec.filmTexture}`,
		`Motion language: ${spec.motionLanguage}`,
		ANIME_CONSISTENCY_CLAUSE,
	].join("\n");
}
