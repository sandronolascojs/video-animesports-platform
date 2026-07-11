// Evalite runner config (phase AI-6b). Evals hit the REAL gateway (paid
// calls) — long per-row timeout, low concurrency to stay gateway-friendly.
// Deliberately NOT wired into turbo's test/check-types pipelines: evals run
// only on demand (`bun run eval`).
//
// testTimeout covers the task AND its scorers for ONE row. Measured on the
// real gateway: claude-sonnet-5 runs with heavy extended thinking, emitting
// 10-13k output tokens per attempt at ~130-155s each; a 3-scene row that
// needed one production-mirrored schema retry took 279s for generation
// alone, before its 3 sequential LLM-judge calls (gpt-5.6-terra, also a
// reasoning model). 5- and 10-scene rows generate proportionally more, so
// the budget is set high enough that even a 10-scene row that retries plus
// judges fits. Long, but this is an on-demand paid eval, not CI — wall-clock
// is not the constraint, completeness is.
// maxConcurrency 2 is the brief's "gateway-friendly" default. Observed on a
// real full plan run: this account's gateway throttled sustained concurrent
// claude-sonnet-5 thinking generations hard (later rows stalled with no
// response for 500s+). If that recurs, drop maxConcurrency to 1 — serial is
// slower wall-clock but sidesteps the concurrent-request rate limit.
import { defineConfig } from "evalite/config";

export default defineConfig({
	testTimeout: 1_200_000,
	maxConcurrency: 2,
	setupFiles: ["./evals/setup.ts"],
});
