// Model ids ONLY — pure string constants with ZERO imports (phase AI-6b).
// Split out of models.ts so eval code (packages/ai/evals, run under node)
// can import the fleet ids without touching models.ts, whose
// `@video-platform-challenge/env/server` import re-exports
// `cloudflare:workers` — a module that cannot load outside a Worker.
// models.ts re-exports these, so existing import sites are unchanged.
//
// Model fleet (verified available on this gateway account 2026-07-12).
// Plan/extend share one model so the episode keeps a single narrative voice.
// The plan agent authors the ENTIRE style bible (art direction, color script,
// lighting) that prepends every image/video prompt — so its model IS the show's
// visual identity. `claude-sonnet-5` produced the brighter, on-model Crunchyroll
// look; the `gpt-5.6-terra` experiment (2026-07-12) shifted the palette darker
// and off-style, so plan/extend are back on sonnet (owner call 2026-07-12). The
// studio chat agent stays on gpt-5.6-terra (high-frequency tool-routing turns,
// no bearing on visuals); eval judges use a DIFFERENT family than the generator
// to avoid same-model self-preference bias — so the judge is gpt-5.6-terra.
export const PLAN_AGENT_MODEL = "anthropic/claude-sonnet-5";
export const STUDIO_AGENT_MODEL = "openai/gpt-5.6-terra";
export const EVAL_JUDGE_MODEL = "openai/gpt-5.6-terra";

// Subtitle STT (docs media-ops-container.md §Feature 2, transcribe.ts) — the
// AI Gateway's `openai/whisper-1`. Swapped in for kie's
// `elevenlabs/speech-to-text`, which is 401 UNAUTHORIZED for this account's
// key (verified against the live API, same failure mode as the ElevenLabs
// TTS removed earlier). Confirmed working via
// packages/ai/evals/transcribe-check.ts: transcribing a seedance mp4 (video +
// audio) returned real segment timestamps and durationInSeconds — no ffmpeg
// extraction needed, whisper reads the audio track straight out of the mp4.
export const TRANSCRIPTION_MODEL = "openai/whisper-1";
