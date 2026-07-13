// The media-ops ffmpeg server (docs/media-ops-container.md §1). Stateless and
// dumb on purpose: it only shells ffmpeg. No R2 credentials, no business logic —
// the Worker (apps/server) owns R2 signing/orchestration and hands this server an
// already-signed, publicly-fetchable video URL. Runs in the CF Container image.
//
// Fastify + TypeScript (run via tsx, no build step). ffmpeg args are ALWAYS passed
// as an array to spawn() — never a shell string — so a hostile videoUrl can't
// inject shell. Outputs are small (a JPEG frame / a short-clip mp3), so we buffer
// ffmpeg's stdout and only respond once we know it succeeded — clean error
// handling instead of a half-streamed "success".
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { env } from "./env";

const STDERR_TAIL = 4000;

// Defense-in-depth (docs/media-ops-container.md): the CF Container binding is
// already private (only the server Worker can reach it in prod), but the
// LOCAL Docker container binds a port any other local process could hit —
// this shared-secret check closes that gap without requiring one in prod
// (where the binding alone already isolates it). `MEDIA_OPS_SECRET` is set on
// both this container's env and the Worker's binding by alchemy; unset here
// means "pure local run without the secret" (e.g. `node`/`tsx server.ts`
// directly), which stays allowed so local dev never needs it configured.
const MEDIA_OPS_SECRET = env.MEDIA_OPS_SECRET;
let warnedNoSecretOnce = false;

function headerValue(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

function isAuthorized(headers: {
	authorization?: string | string[];
	"x-media-ops-secret"?: string | string[];
}): boolean {
	const authorization = headerValue(headers.authorization);
	const bearer = authorization?.startsWith("Bearer ")
		? authorization.slice("Bearer ".length)
		: undefined;
	const provided = bearer ?? headerValue(headers["x-media-ops-secret"]);
	return provided === MEDIA_OPS_SECRET;
}

type ExtractBody = {
	videoUrl?: unknown;
	atSeconds?: unknown;
	format?: unknown;
};

function isHttpUrl(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		const u = new URL(value);
		return u.protocol === "http:" || u.protocol === "https:";
	} catch {
		return false;
	}
}

/** Runs ffmpeg with a fixed arg array, buffering stdout. Resolves the output
 * bytes on exit 0; rejects with the stderr tail otherwise. */
function runFfmpeg(args: string[]): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
		const out: Buffer[] = [];
		let err = "";
		ff.stdout.on("data", (c: Buffer) => out.push(c));
		ff.stderr.on("data", (c: Buffer) => {
			err = (err + c.toString("utf8")).slice(-STDERR_TAIL);
		});
		ff.on("error", (e) =>
			reject(new Error(`ffmpeg failed to start: ${e.message}`)),
		);
		ff.on("close", (code) => {
			if (code === 0) return resolve(Buffer.concat(out));
			reject(new Error(`ffmpeg exited ${code}\n${err}`));
		});
	});
}

/** Downloads a video to a temp file (frame extraction needs a SEEKABLE input —
 * `-sseof` can't seek a remote http stream). Returns the path + a cleanup fn. */
async function downloadToTemp(
	url: string,
): Promise<{ dir: string; path: string; cleanup: () => Promise<void> }> {
	const res = await fetch(url);
	if (!res.ok || !res.body) throw new Error(`fetch video ${res.status}`);
	const dir = await mkdtemp(join(tmpdir(), "media-ops-"));
	const path = join(dir, "input");
	await writeFile(path, Buffer.from(await res.arrayBuffer()));
	return {
		dir,
		path,
		cleanup: () => rm(dir, { recursive: true, force: true }),
	};
}

const app = Fastify({ bodyLimit: 1 << 20 });

// Health check stays unauthenticated (CF Container health probes + local
// `curl` sanity checks hit this without the secret); every other route is
// gated below, BEFORE any ffmpeg work starts.
app.addHook("onRequest", async (request, reply) => {
	if (request.method === "GET" && request.url === "/") {
		return;
	}
	if (!MEDIA_OPS_SECRET) {
		if (!warnedNoSecretOnce) {
			warnedNoSecretOnce = true;
			app.log.warn(
				"MEDIA_OPS_SECRET is not set — media-ops is running WITHOUT auth (expected only for a pure local run; alchemy sets this secret everywhere else)",
			);
		}
		return;
	}
	if (!isAuthorized(request.headers)) {
		reply.code(401).send("Unauthorized");
	}
});

app.get("/", async () => "ok");

app.post<{ Body: ExtractBody }>("/extract-frame", async (req, reply) => {
	const { videoUrl } = req.body ?? {};
	if (!isHttpUrl(videoUrl)) {
		return reply.code(400).send("videoUrl must be an http(s) URL string");
	}
	// `-update 1` decodes the clip forward and overwrites a single output file for
	// every frame, so the LAST write is the exact last frame. Robust on any input
	// (no seeking — remote/odd containers make `-sseof` land past the last frame
	// and decode nothing) and memory-safe (only one JPEG on disk, not all frames
	// buffered like `-vf reverse`). The clips are short (≤15s), so a forward decode
	// is fast. Needs a SEEKABLE local input, hence the temp download.
	const { dir, path, cleanup } = await downloadToTemp(videoUrl);
	const output = join(dir, "frame.jpg");
	try {
		await runFfmpeg(["-y", "-i", path, "-update", "1", "-q:v", "2", output]);
		const jpeg = await readFile(output);
		return reply.header("content-type", "image/jpeg").send(jpeg);
	} catch (e) {
		return reply.code(500).send((e as Error).message);
	} finally {
		await cleanup();
	}
});

app.post<{ Body: ExtractBody }>("/extract-audio", async (req, reply) => {
	const { videoUrl } = req.body ?? {};
	if (!isHttpUrl(videoUrl)) {
		return reply.code(400).send("videoUrl must be an http(s) URL string");
	}
	// Audio is a linear read — ffmpeg streams the remote URL directly, no temp file.
	try {
		const mp3 = await runFfmpeg([
			"-i",
			videoUrl,
			"-vn",
			"-acodec",
			"libmp3lame",
			"-f",
			"mp3",
			"pipe:1",
		]);
		return reply.header("content-type", "audio/mpeg").send(mp3);
	} catch (e) {
		return reply.code(500).send((e as Error).message);
	}
});

app.listen({ port: env.PORT, host: "0.0.0.0" }, (err, address) => {
	if (err) {
		app.log.error(err);
		process.exit(1);
	}
	console.log(`media-ops listening on ${address}`);
});
