/**
 * STT feasibility probe: transcribe the seedance mp4 (video+audio) via the AI
 * Gateway + whisper-1, asking for word/segment timestamps. mp4 is a supported
 * whisper input (audio extracted server-side) — no ffmpeg needed. Proves we can
 * get REAL speech timings for perfect subtitle sync using our existing gateway key.
 *
 * Run: bun run packages/ai/evals/transcribe-check.ts "<mp4-url>"
 */
import { fileURLToPath } from "node:url";
import { createGateway } from "@ai-sdk/gateway";
import { experimental_transcribe as transcribe } from "ai";

const envText = await Bun.file(
	fileURLToPath(new URL("../../../apps/server/.env", import.meta.url)),
).text();
for (const line of envText.split("\n")) {
	const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
	if (m && process.env[m[1]] === undefined)
		process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const KEY = process.env.AI_GATEWAY_API_KEY;
if (!KEY) throw new Error("missing AI_GATEWAY_API_KEY");

const url =
	process.argv[2] ??
	"https://tempfile.aiquickdraw.com/seedance/1783911107050-24x588w4s0r.mp4";
console.log(`fetching ${url}`);
const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
console.log(`mp4 bytes: ${bytes.length}`);

const gateway = createGateway({ apiKey: KEY });
// biome-ignore lint/suspicious/noExplicitAny: probe both provider shapes
const g = gateway as any;
const model = g.transcription
	? g.transcription("openai/whisper-1")
	: g("openai/whisper-1");

const result = await transcribe({
	model,
	audio: bytes,
	providerOptions: {
		openai: { timestampGranularities: ["word", "segment"] },
	},
});

console.log("\n=== TEXT ===\n" + result.text);
console.log("\n=== SEGMENTS ===");
for (const s of result.segments ?? []) {
	console.log(
		`[${s.startSecond?.toFixed?.(2)}-${s.endSecond?.toFixed?.(2)}] ${s.text}`,
	);
}
console.log("\n=== durationInSeconds ===", result.durationInSeconds);
