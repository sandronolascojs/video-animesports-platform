// Pure classification logic extracted out of generation.service.ts's
// `fetchAndPutToR2Guarded` (GEN-2, docs ai-architecture-v1.md §5 finding 2),
// same testability split as lib/fail-reason.ts — the service module imports
// `cloudflare:workers` transitively, so plain `bun:test` needs this piece
// pulled out.
//
// Before this fix, only the allowlist rejection (`BadResultUrlError`) was
// ever persisted onto the owning `generation_tasks` row — every OTHER
// post-kie-success ingest failure (a `fetch` throwing, a non-2xx result
// status, `putObject` itself throwing) fell through to a bare `throw error`,
// leaving that row stuck `pending` forever even though kie.ai had already
// billed the task and the scene/project above it got marked failed
// separately. This mirrors fix-pass C4's poll-timeout fix (the same class of
// bug, one layer up the stack) by giving EVERY ingest failure path a
// fail_code before it's rethrown.

/** The two fail codes a caller of `classifyIngestFailure` ever persists — kept
 * as a literal union (not `string`) so a future new ingest-failure class has
 * to be a deliberate addition here, not an ad-hoc string at a call site. */
export type IngestFailureCode = "BAD_RESULT_URL" | "INGEST_FAILED";

export interface IngestFailureClassification {
	failCode: IngestFailureCode;
	failMsg: string;
}

/**
 * Classifies any error thrown by `fetchAndPutToR2` into the `(failCode,
 * failMsg)` pair `markGenerationTaskFailed` persists. `isBadResultUrlError`
 * is injected (rather than an `instanceof BadResultUrlError` check here)
 * so this stays free of that class's module — the class itself stays
 * private to generation.service.ts, this helper only needs a predicate.
 */
export function classifyIngestFailure(
	error: unknown,
	isBadResultUrlError: (error: unknown) => boolean,
): IngestFailureClassification {
	const failMsg = error instanceof Error ? error.message : String(error);
	if (isBadResultUrlError(error)) {
		return { failCode: "BAD_RESULT_URL", failMsg };
	}
	return { failCode: "INGEST_FAILED", failMsg };
}
