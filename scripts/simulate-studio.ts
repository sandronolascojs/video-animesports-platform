/**
 * Simulates the Studio generation flow end-to-end against the LOCAL dev server,
 * hitting the exact same oRPC + better-auth HTTP endpoints the web app uses:
 *
 *   1. authenticate (sign in, or sign up on first run) as a dedicated sim user
 *   2. projects.create  -> kicks the plan + generation workflow (clips)
 *   3. poll projects.get -> watch scene statuses fill in
 *   4. scenes.retry      -> retry any scene that fails (up to MAX_RETRIES each)
 *   5. report the final state
 *
 * Purpose: reproduce/diagnose the "kie 400" that shows up on generation/retry
 * (docs/studio-fixes-backlog.md #6) with a repeatable driver — while it runs,
 * watch the worker log; packages/kie/src/client.ts now logs the real 400 body.
 *
 * The project is created under the sim user; reassign it to a real account
 * afterwards with scripts/reassign-project.ts if needed.
 *
 * Run (dev server must be up on :3000):
 *   bun run scripts/simulate-studio.ts "messi scores a last-minute free kick" soccer 3
 * Args: [description] [templateKey] [sceneCount]
 */
const SERVER = process.env.SIM_SERVER ?? "http://localhost:3000";
const ORIGIN = process.env.SIM_ORIGIN ?? "http://localhost:3001";
const EMAIL = process.env.SIM_EMAIL ?? "studio-sim@zenkai.dev";
const PASSWORD = process.env.SIM_PASSWORD ?? "password1234";

const MAX_RETRIES_PER_SCENE = 2;
const POLL_INTERVAL_MS = 6000;
const POLL_TIMEOUT_MS = 20 * 60 * 1000; // 20 min — generation is minutes-long

const description =
	process.argv[2] ??
	"A striker chases redemption with a last-minute free kick.";
const templateKey = process.argv[3] ?? "soccer";
const sceneCount = Number(process.argv[4] ?? 3);

function log(...args: unknown[]) {
	console.log(`[sim ${new Date().toISOString().slice(11, 19)}]`, ...args);
}

async function authenticate(): Promise<string> {
	// Try sign-in first; fall back to sign-up on the first-ever run.
	for (const kind of ["sign-in", "sign-up"] as const) {
		const path = `/api/auth/${kind === "sign-in" ? "sign-in" : "sign-up"}/email`;
		const body =
			kind === "sign-up"
				? { name: "Studio Sim", email: EMAIL, password: PASSWORD }
				: { email: EMAIL, password: PASSWORD };
		const res = await fetch(`${SERVER}${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: ORIGIN },
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			continue;
		}
		const setCookies = res.headers.getSetCookie?.() ?? [];
		const session = setCookies.find((c) =>
			c.startsWith("better-auth.session_token="),
		);
		if (session) {
			log(`authenticated via ${kind} as ${EMAIL}`);
			return session.split(";")[0]; // "better-auth.session_token=<...>"
		}
	}
	throw new Error("authentication failed (sign-in and sign-up both failed)");
}

async function rpc<T = unknown>(
	cookie: string,
	path: string,
	input: unknown,
): Promise<T> {
	const res = await fetch(`${SERVER}/rpc/${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: ORIGIN,
			Cookie: cookie,
		},
		body: JSON.stringify({ json: input }),
	});
	const text = await res.text();
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		parsed = text;
	}
	if (!res.ok) {
		throw new Error(`rpc ${path} -> ${res.status}: ${text.slice(0, 400)}`);
	}
	// RPCHandler wraps success output as { json: <output> }.
	return ((parsed as { json?: T })?.json ?? parsed) as T;
}

type Scene = { id: string; title?: string | null; status: string };
type ProjectDetail = {
	id: string;
	status: string;
	title?: string | null;
	scenes?: Scene[];
};

async function main() {
	log(`server=${SERVER} template=${templateKey} scenes=${sceneCount}`);
	log(`description: "${description}"`);
	const cookie = await authenticate();

	log("creating project (kicks plan + generation workflow)…");
	const project = await rpc<ProjectDetail>(cookie, "projects/create", {
		description,
		templateKey,
		aspectRatio: "16:9",
		audioLanguage: "en",
		subtitleLanguage: "en",
		sceneCount,
	});
	log(`project created: id=${project.id} status=${project.status}`);

	const retryCounts = new Map<string, number>();
	const start = Date.now();

	while (Date.now() - start < POLL_TIMEOUT_MS) {
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
		let detail: ProjectDetail;
		try {
			detail = await rpc<ProjectDetail>(cookie, "projects/get", {
				id: project.id,
			});
		} catch (err) {
			log("poll error (will retry):", String(err).slice(0, 200));
			continue;
		}
		const scenes = detail.scenes ?? [];
		const summary = scenes
			.map((s) => `${(s.title ?? s.id).slice(0, 14)}:${s.status}`)
			.join("  ");
		log(`status=${detail.status} | ${summary || "(no scenes yet)"}`);

		// Retry any failed scene, bounded.
		for (const scene of scenes) {
			if (scene.status !== "failed") {
				continue;
			}
			const used = retryCounts.get(scene.id) ?? 0;
			if (used >= MAX_RETRIES_PER_SCENE) {
				continue;
			}
			retryCounts.set(scene.id, used + 1);
			log(`retrying failed scene ${scene.id} (attempt ${used + 1})…`);
			try {
				await rpc(cookie, "scenes/retry", { id: scene.id });
			} catch (err) {
				log("retry call error:", String(err).slice(0, 200));
			}
		}

		const allReady =
			scenes.length > 0 && scenes.every((s) => s.status === "video_ready");
		const terminalFailed =
			detail.status === "failed" ||
			(scenes.length > 0 &&
				scenes.every(
					(s) =>
						s.status === "video_ready" ||
						(s.status === "failed" &&
							(retryCounts.get(s.id) ?? 0) >= MAX_RETRIES_PER_SCENE),
				) &&
				scenes.some((s) => s.status === "failed"));

		if (allReady) {
			log(
				`DONE — all ${scenes.length} scenes video_ready. project=${project.id}`,
			);
			return;
		}
		if (terminalFailed) {
			log(`STOPPED — generation failed after retries. project=${project.id}`);
			log("Check the worker log for the '[kie] request failed' body.");
			return;
		}
	}
	log(`TIMEOUT after ${POLL_TIMEOUT_MS / 60000}min. project=${project.id}`);
}

main().catch((err) => {
	console.error("simulate-studio failed:", err);
	process.exit(1);
});
