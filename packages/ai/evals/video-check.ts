/**
 * End-to-end video check: reuses the cached plan + character sheet, generates
 * ONE scene's two fencing keyframes (start Kᵢ, end Kᵢ₊₁) via gpt-image-2, then
 * runs bytedance/seedance-2-mini between them → downloads the mp4. This is the
 * REAL production path for a single scene, to confirm the video output matches
 * the template look. One seedance call only.
 *
 * Run: bun run packages/ai/evals/video-check.ts [sceneIndex1based]
 * Needs .style-out/plan.json + sheet-url.txt (run style-check.ts first).
 */
import { fileURLToPath } from "node:url";
import {
	buildKeyframePrompt,
	buildSceneVideoPrompt,
} from "../src/prompts/prompt-builders";
import { compileStyleBible } from "../src/prompts/style-bible";

const envText = await Bun.file(
	fileURLToPath(new URL("../../../apps/server/.env", import.meta.url)),
).text();
for (const line of envText.split("\n")) {
	const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
	if (m && process.env[m[1]] === undefined)
		process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const KIE_KEY = process.env.KIE_API_KEY;
if (!KIE_KEY) throw new Error("missing KIE_API_KEY");
const OUT = fileURLToPath(new URL("./.style-out/", import.meta.url));
const sceneIdx = process.argv[2] ? Number(process.argv[2]) - 1 : 1; // default scene 2 (dramatic)

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
	const j = (await res.json()) as { code: number; msg: string; data: T };
	if (!res.ok || j.code !== 200)
		throw new Error(`kie ${path} ${res.status}: ${j.msg}`);
	return j.data;
}

async function poll(taskId: string, budget: number): Promise<string> {
	for (let i = 0; i < budget; i++) {
		await new Promise((r) => setTimeout(r, 8000));
		const rec = await kie<{
			state: string;
			resultJson?: string;
			failMsg?: string;
		}>(`/api/v1/jobs/recordInfo?taskId=${taskId}`, "GET");
		if (rec.state === "success")
			return (JSON.parse(rec.resultJson ?? "{}").resultUrls ?? [])[0];
		if (rec.state === "fail") throw new Error(`fail: ${rec.failMsg}`);
		process.stdout.write(".");
	}
	throw new Error(`task ${taskId} timed out`);
}

async function genImage(prompt: string, inputUrls: string[]): Promise<string> {
	for (let attempt = 1; attempt <= 4; attempt++) {
		const { taskId } = await kie<{ taskId: string }>(
			"/api/v1/jobs/createTask",
			"POST",
			{
				model: "gpt-image-2-image-to-image",
				input: {
					prompt,
					aspect_ratio: "16:9",
					resolution: "2K",
					input_urls: inputUrls,
				},
			},
		);
		try {
			return await poll(taskId, 90);
		} catch (e) {
			console.log(`\n  image attempt ${attempt} failed: ${e}`);
		}
	}
	throw new Error("image failed 4x");
}

// biome-ignore lint/suspicious/noExplicitAny: dynamic plan
const plan: any = await Bun.file(`${OUT}plan.json`).json();
const sheetUrl = (await Bun.file(`${OUT}sheet-url.txt`).text()).trim();
const styleBlock = compileStyleBible(plan.styleBibleSpec);

// Scene i fences on keyframes[i] (start) and keyframes[i+1] (end).
const kStart = plan.keyframes[sceneIdx];
const kEnd = plan.keyframes[sceneIdx + 1];
const scene = plan.scenes[sceneIdx];
const cinematography = scene.cinematography;
const locOf = (k: any) =>
	plan.locations.find((l: any) => l.key === k.locationKey)?.description;

console.log(`scene ${sceneIdx + 1}: ${scene.prompt}\n`);
console.log("=== start keyframe ===");
const startUrl = await genImage(
	buildKeyframePrompt(styleBlock, kStart, locOf(kStart)),
	[sheetUrl],
);
console.log("\n=== end keyframe (chained) ===");
const endUrl = await genImage(
	buildKeyframePrompt(styleBlock, kEnd, locOf(kEnd)),
	[sheetUrl, startUrl],
);

console.log(
	"\n=== seedance video (first=start, last=end, 480p, generate_audio) ===",
);
const videoPrompt = buildSceneVideoPrompt(
	styleBlock,
	cinematography,
	scene.prompt,
	scene.dialogue,
	scene.speaker,
);
const { taskId } = await kie<{ taskId: string }>(
	"/api/v1/jobs/createTask",
	"POST",
	{
		model: "bytedance/seedance-2-mini",
		input: {
			prompt: videoPrompt,
			first_frame_url: startUrl,
			last_frame_url: endUrl,
			aspect_ratio: "16:9",
			resolution: "480p",
			duration: Math.min(
				Math.max(Math.round(scene.durationSeconds ?? 5), 4),
				15,
			),
			generate_audio: true,
		},
	},
);
console.log(`  seedance task ${taskId}`);
const videoUrl = await poll(taskId, 60);
const res = await fetch(videoUrl);
await Bun.write(
	`${OUT}scene-${sceneIdx + 1}.mp4`,
	new Uint8Array(await res.arrayBuffer()),
);
console.log(`\nDONE. scene-${sceneIdx + 1}.mp4 in ${OUT}`);
