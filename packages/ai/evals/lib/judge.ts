// Shared LLM-judge plumbing (phase AI-6b). One verdict schema + grade→score
// mapping for every judge scorer, so all three suites read on the same
// scale. Uses `generateText` + `Output.object` (this repo's ai@7 convention
// — `generateObject` is deprecated in v7, see plan.agent.ts).
import { generateText, Output } from "ai";
import { z } from "zod";
import { judgeModel } from "./models";

const verdictSchema = z.object({
	grade: z.enum(["excellent", "good", "weak", "fail"]),
	rationale: z
		.string()
		.describe("2-4 sentences citing concrete evidence from the material."),
});

type Verdict = z.infer<typeof verdictSchema>;

const GRADE_SCORES: Record<Verdict["grade"], number> = {
	excellent: 1,
	good: 0.75,
	weak: 0.4,
	fail: 0,
};

const JUDGE_SYSTEM_PROMPT = [
	"You are a strict evaluation judge for an AI anime-episode story generator.",
	"Grade ONLY against the stated criteria — ignore qualities the criteria do not ask about.",
	"Be severe: 'excellent' means a professional showrunner would sign off without notes; 'good' means solid with minor gaps; 'weak' means noticeable failures a viewer would feel; 'fail' means the criteria are not met.",
	"Cite concrete evidence from the material in your rationale.",
].join("\n");

export interface JudgeResult {
	score: number;
	metadata: { grade: Verdict["grade"]; rationale: string };
}

export async function runJudge(args: {
	criteria: string;
	material: string;
}): Promise<JudgeResult> {
	const result = await generateText({
		model: judgeModel(),
		system: JUDGE_SYSTEM_PROMPT,
		prompt: `## Criteria\n${args.criteria}\n\n## Material\n${args.material}\n\nReturn your verdict.`,
		output: Output.object({ schema: verdictSchema }),
	});
	const verdict = result.output as Verdict;
	return {
		score: GRADE_SCORES[verdict.grade],
		metadata: { grade: verdict.grade, rationale: verdict.rationale },
	};
}

/**
 * Skip convention (documented once, reused by every conditional scorer):
 * evalite has no per-row scorer opt-out, so a scorer that doesn't apply to a
 * fixture (e.g. real-person-casting on a fixture with no real people)
 * returns score 1 with `{ skipped: true }` metadata — a neutral pass that
 * never drags the eval's average down. Read scores together with metadata.
 */
export const SKIPPED = { score: 1, metadata: { skipped: true } };
