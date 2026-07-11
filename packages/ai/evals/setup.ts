// Eval env bootstrap (phase AI-6b): loads apps/server/.env — the ONE place
// dev secrets already live (AI_GATEWAY_API_KEY) — into process.env before
// any eval file runs. Vars already present in the shell environment always
// win over the file, so an explicitly exported key overrides the .env value.
// Missing files/keys are NOT fatal here: the eval task itself throws a clear
// error when AI_GATEWAY_API_KEY is absent (see evals/lib/models.ts), which
// surfaces per-row in evalite's UI instead of killing the whole run at setup.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ENV_FILE = fileURLToPath(
	new URL("../../../apps/server/.env", import.meta.url),
);

/** Minimal .env parser fallback: KEY=VALUE lines, `#` comments ignored,
 * single/double surrounding quotes stripped, existing vars never clobbered. */
function loadEnvFileFallback(path: string): void {
	const content = readFileSync(path, "utf8");
	for (const rawLine of content.split("\n")) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) {
			continue;
		}
		const separatorIndex = line.indexOf("=");
		if (separatorIndex <= 0) {
			continue;
		}
		const key = line.slice(0, separatorIndex).trim();
		let value = line.slice(separatorIndex + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		if (process.env[key] === undefined) {
			process.env[key] = value;
		}
	}
}

try {
	if (typeof process.loadEnvFile === "function") {
		// `process.loadEnvFile` may overwrite depending on the node version —
		// snapshot first and restore so the ambient shell env always wins.
		const preexisting = { ...process.env };
		process.loadEnvFile(ENV_FILE);
		for (const [key, value] of Object.entries(preexisting)) {
			if (value !== undefined) {
				process.env[key] = value;
			}
		}
	} else {
		loadEnvFileFallback(ENV_FILE);
	}
} catch {
	console.warn(
		`[evals/setup] could not load ${ENV_FILE} — relying on the shell environment for AI_GATEWAY_API_KEY`,
	);
}
