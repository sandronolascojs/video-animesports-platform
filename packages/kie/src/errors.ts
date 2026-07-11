export interface KieErrorOptions {
	/**
	 * kie.ai's logical status. Prefers the envelope's own numeric `code`
	 * field (present even on HTTP 200 responses that wrap a soft failure,
	 * e.g. `{ code: 402, msg: "..." }`) over the raw HTTP status.
	 * `undefined` means the request never reached kie.ai at all (network,
	 * DNS, timeout).
	 */
	status?: number;
	/** String mirror of `status`, kept for logging/telemetry. */
	code?: string;
	taskId?: string;
	cause?: unknown;
}

/**
 * Typed error for every kie.ai HTTP failure (createTask, getTask, and the
 * model wrappers' own input validation). Carries enough for a Workflow step
 * to branch: `retryable` mirrors docs/video-engine-architecture.md §3's
 * rule — 5xx/429 are transient (provider hiccup, rate limit) and worth a
 * retry; everything else (4xx validation, insufficient credits, auth) is
 * fatal and should surface to the user (e.g. via `NonRetryableError` from
 * `cloudflare:workers` in the Workflow, per §5c.1) rather than retry.
 */
export class KieError extends Error {
	readonly status?: number;
	readonly code?: string;
	readonly taskId?: string;
	readonly retryable: boolean;

	constructor(message: string, options: KieErrorOptions = {}) {
		super(message, { cause: options.cause });
		this.name = "KieError";
		this.status = options.status;
		this.code = options.code;
		this.taskId = options.taskId;
		this.retryable = isRetryableStatus(options.status);
	}
}

function isRetryableStatus(status: number | undefined): boolean {
	if (status === undefined) {
		return true;
	}
	return status === 429 || status >= 500;
}
