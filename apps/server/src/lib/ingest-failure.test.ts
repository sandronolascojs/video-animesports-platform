import { describe, expect, test } from "bun:test";

import { classifyIngestFailure } from "./ingest-failure";

class FakeBadResultUrlError extends Error {}

const isBadResultUrlError = (error: unknown) =>
	error instanceof FakeBadResultUrlError;

describe("classifyIngestFailure", () => {
	test("classifies an allowlist rejection as BAD_RESULT_URL", () => {
		const error = new FakeBadResultUrlError("host not allowlisted");
		const result = classifyIngestFailure(error, isBadResultUrlError);
		expect(result).toEqual({
			failCode: "BAD_RESULT_URL",
			failMsg: "host not allowlisted",
		});
	});

	test("classifies a network fetch failure as INGEST_FAILED", () => {
		const error = new Error("Failed to fetch provider result URL");
		const result = classifyIngestFailure(error, isBadResultUrlError);
		expect(result).toEqual({
			failCode: "INGEST_FAILED",
			failMsg: "Failed to fetch provider result URL",
		});
	});

	test("classifies a non-2xx result status as INGEST_FAILED", () => {
		const error = new Error("Provider result URL returned HTTP 503");
		const result = classifyIngestFailure(error, isBadResultUrlError);
		expect(result.failCode).toBe("INGEST_FAILED");
	});

	test("classifies a putObject (R2) throw as INGEST_FAILED", () => {
		const error = new Error("R2 put failed");
		const result = classifyIngestFailure(error, isBadResultUrlError);
		expect(result.failCode).toBe("INGEST_FAILED");
	});

	test("handles a non-Error thrown value without crashing", () => {
		const result = classifyIngestFailure("boom", isBadResultUrlError);
		expect(result).toEqual({ failCode: "INGEST_FAILED", failMsg: "boom" });
	});
});
