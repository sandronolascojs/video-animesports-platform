/**
 * Cheap style-check harness: runs the REAL plan agent (sonnet) → compiles the
 * style bible → generates ONE character sheet + ONE keyframe directly against
 * kie gpt-image. NO seedance (skips the expensive video step) — this is only
 * to eyeball the ANIME LOOK the current prompts produce.
 *
 * Run: bun run packages/ai/evals/style-check.ts ["brief"] [templateKey]
 * Needs apps/server/.env (AI_GATEWAY_API_KEY + KIE_API_KEY).
 */
import { fileURLToPath } from "node:url";
import { createGateway } from "@ai-sdk/gateway";
import { buildStoryPlanSchema } from "@video-platform-challenge/api";
import { TemplateKey } from "@video-platform-challenge/types";
import { runPlanAgent } from "../src/agents/plan.agent";
import { PLAN_AGENT_MODEL } from "../src/model-ids";
import {
	buildCharacterSheetPrompt,
	buildKeyframePrompt,
} from "../src/prompts/prompt-builders";
import { compileStyleBible } from "../src/prompts/style-bible";

// --- env (parse apps/server/.env — bun only auto-loads cwd/.env) ---
const envText = await Bun.file(
	fileURLToPath(new URL("../../../apps/server/.env", import.meta.url)),
).text();
for (const line of envText.split("\n")) {
	const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
	if (m && process.env[m[1]] === undefined) {
		process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
	}
}
const GATEWAY_KEY = process.env.AI_GATEWAY_API_KEY;
const KIE_KEY = process.env.KIE_API_KEY;
if (!GATEWAY_KEY || !KIE_KEY) {
	throw new Error(
		"missing AI_GATEWAY_API_KEY or KIE_API_KEY in apps/server/.env",
	);
}

const brief =
	process.argv[2] ??
	"In the final seconds, Kaito receives the ball at midfield, dribbles past two defenders, and strikes the winning goal into the top corner";
const templateKey = (process.argv[3] ?? TemplateKey.SOCCER) as TemplateKey;
const OUT = fileURLToPath(new URL("./.style-out/", import.meta.url));

// --- kie gpt-image over direct HTTP (packages/kie reads env via cloudflare:workers, can't run under node) ---
async function kie<T>(
	path: string,
	method: "GET" | "POST",
	body?: unknown,
): Promise<T> {
	const res = await fetch(`https://api.kie.ai${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${KIE_KEY}`,
			"Content-Type": "application/json",
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const json = (await res.json()) as { code: number; msg: string; data: T };
	if (!res.ok || json.code !== 200)
		throw new Error(`kie ${path} ${res.status}: ${json.msg}`);
	return json.data;
}

async function genImageOnce(
	prompt: string,
	inputUrls?: string[],
): Promise<string | null> {
	const model = inputUrls?.length
		? "gpt-image-2-image-to-image"
		: "gpt-image-2-text-to-image";
	const { taskId } = await kie<{ taskId: string }>(
		"/api/v1/jobs/createTask",
		"POST",
		{
			model,
			// 2K for detail parity with the primary/template pipeline (default was too flat at 1K).
			input: {
				prompt,
				aspect_ratio: "16:9",
				resolution: "2K",
				...(inputUrls?.length ? { input_urls: inputUrls } : {}),
			},
		},
	);
	console.log(`  task ${taskId}`);
	for (let i = 0; i < 90; i++) {
		await new Promise((r) => setTimeout(r, 8000));
		const rec = await kie<{
			state: string;
			resultJson?: string;
			failMsg?: string;
		}>(`/api/v1/jobs/recordInfo?taskId=${taskId}`, "GET");
		if (rec.state === "success") {
			const urls = (JSON.parse(rec.resultJson ?? "{}").resultUrls ??
				[]) as string[];
			if (!urls[0]) throw new Error(`no result url for ${taskId}`);
			return urls[0];
		}
		if (rec.state === "fail") {
			console.log(`\n  task failed: ${rec.failMsg}`);
			return null; // transient upstream timeout — caller retries
		}
		process.stdout.write(".");
	}
	console.log(`\n  task ${taskId} timed out (poll budget)`);
	return null;
}

async function genImage(prompt: string, inputUrls?: string[]): Promise<string> {
	for (let attempt = 1; attempt <= 4; attempt++) {
		console.log(`  attempt ${attempt}/4`);
		const url = await genImageOnce(prompt, inputUrls);
		if (url) return url;
	}
	throw new Error("image generation failed after 4 attempts");
}

async function download(url: string, file: string) {
	const res = await fetch(url);
	await Bun.write(`${OUT}${file}`, new Uint8Array(await res.arrayBuffer()));
	console.log(`\nsaved ${file}`);
}

// --- run (plan + sheet URL cached in .style-out so re-runs skip sonnet / a done sheet) ---
const planPath = `${OUT}plan.json`;
const sheetUrlPath = `${OUT}sheet-url.txt`;
// biome-ignore lint/suspicious/noExplicitAny: harness reads dynamic plan shape
let plan: any;
if (await Bun.file(planPath).exists()) {
	console.log("using cached plan.json (skip sonnet)");
	plan = await Bun.file(planPath).json();
} else {
	console.log(
		`plan agent (${PLAN_AGENT_MODEL}) — ${templateKey} — "${brief}"\n`,
	);
	const gateway = createGateway({ apiKey: GATEWAY_KEY });
	plan = await runPlanAgent({
		model: gateway(PLAN_AGENT_MODEL),
		templateKey,
		sceneCount: 3,
		audioLanguage: "en",
		subtitleLanguage: "en",
		prompt: brief,
		schema: buildStoryPlanSchema(3),
	});
	await Bun.write(planPath, JSON.stringify(plan, null, 2));
}

console.log("=== styleBibleSpec (what sonnet wrote) ===");
console.log(JSON.stringify(plan.styleBibleSpec, null, 2));

const styleBlock = compileStyleBible(plan.styleBibleSpec);
const character = plan.characters[0];
// Hero shot (dramatic angle) to match the template stills, not the flat wide establisher.
// Optional argv[4] = keyframe index (1-based).
const kfIndex = process.argv[4] ? Number(process.argv[4]) - 1 : undefined;
const heroKeyframe =
	plan.keyframes.find((k: any) =>
		["low-angle", "over-the-shoulder", "dutch"].includes(k.cameraAngle),
	) ??
	plan.keyframes[1] ??
	plan.keyframes[0];
const keyframe = kfIndex !== undefined ? plan.keyframes[kfIndex] : heroKeyframe;
const location = plan.locations.find(
	(l: any) => l.key === keyframe.locationKey,
);

console.log(`\n=== character sheet: ${character.name} ===`);
let sheetUrl: string;
if (await Bun.file(sheetUrlPath).exists()) {
	sheetUrl = (await Bun.file(sheetUrlPath).text()).trim();
	console.log("using cached sheet url");
} else {
	sheetUrl = await genImage(buildCharacterSheetPrompt(styleBlock, character));
	await Bun.write(sheetUrlPath, sheetUrl);
}
await download(sheetUrl, `sheet-${character.name}.png`);

console.log("\n=== generating keyframe K1 (i2i w/ sheet) ===");
console.log(`  desc: ${keyframe.description}`);
const kfUrl = await genImage(
	buildKeyframePrompt(styleBlock, keyframe, location?.description),
	[sheetUrl],
);
await download(kfUrl, "keyframe-hero.png");

console.log(`\nDONE. images in ${OUT}`);
