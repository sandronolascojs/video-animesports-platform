import { describe, expect, test } from "bun:test";

import { isUniqueViolationError } from "./pg-errors";

describe("isUniqueViolationError", () => {
	test("true for a pg-shaped error with code 23505", () => {
		expect(isUniqueViolationError({ code: "23505" })).toBe(true);
	});

	test("false for a different pg error code", () => {
		expect(isUniqueViolationError({ code: "23503" })).toBe(false);
	});

	test("false for a plain Error with no code", () => {
		expect(isUniqueViolationError(new Error("boom"))).toBe(false);
	});

	test("false for null/undefined/primitives", () => {
		expect(isUniqueViolationError(null)).toBe(false);
		expect(isUniqueViolationError(undefined)).toBe(false);
		expect(isUniqueViolationError("23505")).toBe(false);
		expect(isUniqueViolationError(23505)).toBe(false);
	});

	test("false when code is the right value but wrong type", () => {
		expect(isUniqueViolationError({ code: 23505 })).toBe(false);
	});
});
