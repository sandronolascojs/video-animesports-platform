// Model ids ONLY — pure string constants with ZERO imports (phase AI-6b).
// Split out of models.ts so eval code (packages/ai/evals, run under node)
// can import the fleet ids without touching models.ts, whose
// `@video-platform-challenge/env/server` import re-exports
// `cloudflare:workers` — a module that cannot load outside a Worker.
// models.ts re-exports these, so existing import sites are unchanged.
//
// Model fleet (verified available on this gateway account 2026-07-12).
// Plan/extend share one model so the episode keeps a single narrative voice —
// now `gpt-5.6-terra`, the more creative model, for richer/coherent stories
// (owner call 2026-07-12). The studio chat agent runs the same balanced model
// for its high-frequency, short tool-routing turns; eval judges deliberately
// use a DIFFERENT family than the generator to avoid same-model self-preference
// bias — so the judge moves to `claude-sonnet-5` now that the generator is gpt.
export const PLAN_AGENT_MODEL = "openai/gpt-5.6-terra";
export const STUDIO_AGENT_MODEL = "openai/gpt-5.6-terra";
export const EVAL_JUDGE_MODEL = "anthropic/claude-sonnet-5";
