import { describe, expect, test } from "bun:test";
import type { StyleBibleSpec } from "@video-platform-challenge/types";

import { ANIME_CONSISTENCY_CLAUSE, compileStyleBible } from "./style-bible";

const SPEC: StyleBibleSpec = {
	artDirection: "Late-2000s Shonen sports anime.",
	lineArt: "Bold black keyline, hard-edged highlights.",
	colorScript: "Saturated primary-color kits.",
	characterRendering: "Lanky proportions, large expressive eyes.",
	lighting: "Warm floodlight halation at night.",
	cameraGrammar: "Wide establishing, tight cuts on impact.",
	filmTexture: "Light grain, soft bloom on highlights.",
	motionLanguage: "Impact frames, radial speed lines.",
};

describe("compileStyleBible", () => {
	test("includes every spec field's content, labeled", () => {
		const block = compileStyleBible(SPEC);
		expect(block).toContain("Art direction: Late-2000s Shonen sports anime.");
		expect(block).toContain(
			"Line art: Bold black keyline, hard-edged highlights.",
		);
		expect(block).toContain("Color script: Saturated primary-color kits.");
		expect(block).toContain(
			"Character rendering: Lanky proportions, large expressive eyes.",
		);
		expect(block).toContain("Lighting: Warm floodlight halation at night.");
		expect(block).toContain(
			"Camera grammar: Wide establishing, tight cuts on impact.",
		);
		expect(block).toContain(
			"Film texture: Light grain, soft bloom on highlights.",
		);
		expect(block).toContain(
			"Motion language: Impact frames, radial speed lines.",
		);
	});

	test("always appends the hard consistency clause verbatim", () => {
		const block = compileStyleBible(SPEC);
		expect(block).toContain(ANIME_CONSISTENCY_CLAUSE);
		expect(block.endsWith(ANIME_CONSISTENCY_CLAUSE)).toBe(true);
	});

	test("is deterministic — same spec compiles to the same block every time", () => {
		expect(compileStyleBible(SPEC)).toBe(compileStyleBible(SPEC));
	});

	test("never lets the LLM paraphrase the consistency clause: it does not depend on spec content", () => {
		const otherSpec: StyleBibleSpec = {
			...SPEC,
			artDirection: "Something else entirely.",
		};
		const blockA = compileStyleBible(SPEC);
		const blockB = compileStyleBible(otherSpec);
		expect(blockA).toContain(ANIME_CONSISTENCY_CLAUSE);
		expect(blockB).toContain(ANIME_CONSISTENCY_CLAUSE);
	});
});
