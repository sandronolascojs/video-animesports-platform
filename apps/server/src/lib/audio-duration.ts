// Dependency-free audio duration parsing for TTS ingest (GEN-3, docs
// ai-architecture-v1.md §5 finding 3). Pure byte-math, no db/env import, so
// plain `bun:test` can exercise it directly (same split as every other file
// in this directory).
//
// Why this exists: `isReferenceAudioDurationValid` (generation.service.ts)
// has always been a documented no-op — nothing ever populated
// `asset.metadata.durationSeconds` on speech ingest, so a sub-2-second TTS
// clip ("Goal!") could reach Seedance as `reference_audio_urls` and hard-fail
// the whole scene as a non-retryable 4xx instead of degrading to
// prompt-spoken dialogue. `resolveAudioDurationSeconds` gives that guard a
// real value to check, computed straight from the downloaded bytes — no
// extra network round-trip, no external library.
//
// kie.ai's ElevenLabs TTS proxy can hand back either a WAV or an MP3 byte
// stream (not documented which, and not something this codebase can probe
// against a live key per this pass's scope) — both parsers are attempted, in
// order, before falling back to a conservative word-count estimate.
import type { AssetMetadata } from "@video-platform-challenge/types";

export type AudioDurationMethod =
	| "wav-header"
	| "mp3-frame-estimate"
	| "word-count-heuristic";

export interface AudioDurationResult {
	durationSeconds: number;
	method: AudioDurationMethod;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
	let out = "";
	for (let i = 0; i < length; i++) {
		out += String.fromCharCode(bytes[offset + i] ?? 0);
	}
	return out;
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
	return (
		((bytes[offset] ?? 0) |
			((bytes[offset + 1] ?? 0) << 8) |
			((bytes[offset + 2] ?? 0) << 16) |
			((bytes[offset + 3] ?? 0) << 24)) >>>
		0
	);
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

// ---------------------------------------------------------------------------
// WAV (RIFF/WAVE) — chunk-walked, not fixed-offset: a real encoder can emit
// extra chunks (e.g. `LIST`/`fact`) before `data`, and `fmt `/`data` can
// appear in either order.
// ---------------------------------------------------------------------------

/**
 * Parses a WAV byte stream's duration from its `fmt `/`data` chunks. Returns
 * `null` for anything that isn't a well-formed RIFF/WAVE stream (including a
 * truncated/malformed header) — callers fall through to the next format
 * rather than trust a guess.
 */
export function parseWavDurationSeconds(bytes: Uint8Array): number | null {
	if (
		bytes.length < 12 ||
		readAscii(bytes, 0, 4) !== "RIFF" ||
		readAscii(bytes, 8, 4) !== "WAVE"
	) {
		return null;
	}

	let offset = 12;
	let byteRate: number | null = null;
	let dataSize: number | null = null;

	while (offset + 8 <= bytes.length) {
		const chunkId = readAscii(bytes, offset, 4);
		const chunkSize = readUInt32LE(bytes, offset + 4);
		const bodyOffset = offset + 8;

		if (chunkId === "fmt " && bodyOffset + 16 <= bytes.length) {
			const channels = readUInt16LE(bytes, bodyOffset + 2);
			const sampleRate = readUInt32LE(bytes, bodyOffset + 4);
			const declaredByteRate = readUInt32LE(bytes, bodyOffset + 8);
			const bitsPerSample = readUInt16LE(bytes, bodyOffset + 14);
			byteRate =
				declaredByteRate > 0
					? declaredByteRate
					: (sampleRate * channels * bitsPerSample) / 8;
		} else if (chunkId === "data") {
			// Clamp to what's actually in the buffer — a truncated download
			// shouldn't be trusted past its own length even if the header
			// claims more.
			dataSize = Math.min(chunkSize, bytes.length - bodyOffset);
		}

		// RIFF chunks are padded to an even byte count.
		offset = bodyOffset + chunkSize + (chunkSize % 2);
	}

	if (
		byteRate === null ||
		byteRate <= 0 ||
		dataSize === null ||
		dataSize <= 0
	) {
		return null;
	}
	return dataSize / byteRate;
}

// ---------------------------------------------------------------------------
// MP3 — first-frame-header estimate: locate one syntactically valid MPEG
// audio frame sync, read its bitrate/sample rate, then divide the total
// remaining (post-ID3) byte length by that bitrate. Exact for CBR streams
// (the common case for a short TTS utterance); an approximation for VBR —
// acceptable here since this only feeds a coarse 2-15s reference-audio
// bound, not a playback clock.
// ---------------------------------------------------------------------------

const MPEG1_BITRATES_KBPS: Record<1 | 2 | 3, readonly number[]> = {
	1: [
		-1, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, -1,
	],
	2: [-1, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, -1],
	3: [-1, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1],
};

// MPEG Version 2 and 2.5 share one bitrate table per layer; Layer II and III
// are additionally identical to each other (standard MPEG table, not a typo).
const MPEG2_BITRATES_KBPS: Record<1 | 2 | 3, readonly number[]> = {
	1: [-1, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, -1],
	2: [-1, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1],
	3: [-1, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1],
};

const SAMPLE_RATES_HZ: Record<
	"mpeg1" | "mpeg2" | "mpeg2.5",
	readonly number[]
> = {
	mpeg1: [44100, 48000, 32000, -1],
	mpeg2: [22050, 24000, 16000, -1],
	"mpeg2.5": [11025, 12000, 8000, -1],
};

interface Mp3FrameHeader {
	bitrateKbps: number;
	sampleRateHz: number;
}

/** How far into the buffer to scan for the first valid frame sync before
 * giving up — generous for any realistic ID3 tag + a little garbage, cheap
 * even for a large buffer since it's a plain byte loop. */
const MP3_SYNC_SEARCH_WINDOW_BYTES = 64 * 1024;

function parseMp3FirstFrameHeader(
	bytes: Uint8Array,
	searchStart: number,
): Mp3FrameHeader | null {
	const searchEnd = Math.min(
		bytes.length - 4,
		searchStart + MP3_SYNC_SEARCH_WINDOW_BYTES,
	);

	for (let i = searchStart; i <= searchEnd; i++) {
		const b0 = bytes[i];
		const b1 = bytes[i + 1];
		const b2 = bytes[i + 2];
		if (
			b0 !== 0xff ||
			b1 === undefined ||
			(b1 & 0xe0) !== 0xe0 ||
			b2 === undefined
		) {
			continue;
		}

		const versionBits = (b1 >> 3) & 0b11;
		const layerBits = (b1 >> 1) & 0b11;
		// 01 = reserved MPEG version, 00 = reserved layer — never a real frame.
		if (versionBits === 0b01 || layerBits === 0b00) {
			continue;
		}

		const version: "mpeg1" | "mpeg2" | "mpeg2.5" =
			versionBits === 0b11
				? "mpeg1"
				: versionBits === 0b10
					? "mpeg2"
					: "mpeg2.5";
		const layer: 1 | 2 | 3 =
			layerBits === 0b11 ? 1 : layerBits === 0b10 ? 2 : 3;

		const bitrateIndex = (b2 >> 4) & 0b1111;
		const sampleRateIndex = (b2 >> 2) & 0b11;

		const bitrateTable =
			version === "mpeg1"
				? MPEG1_BITRATES_KBPS[layer]
				: MPEG2_BITRATES_KBPS[layer];
		const bitrateKbps = bitrateTable[bitrateIndex];
		const sampleRateHz = SAMPLE_RATES_HZ[version][sampleRateIndex];

		if (
			!bitrateKbps ||
			bitrateKbps <= 0 ||
			!sampleRateHz ||
			sampleRateHz <= 0
		) {
			continue;
		}

		return { bitrateKbps, sampleRateHz };
	}

	return null;
}

/** Synchsafe (7-bit-per-byte) ID3v2 tag size, so an MP3 with a leading tag
 * doesn't get mistaken for garbage while scanning for the frame sync, and
 * the tag's own bytes don't inflate the audio byte count used below. */
function skipId3v2Tag(bytes: Uint8Array): number {
	if (bytes.length < 10 || readAscii(bytes, 0, 3) !== "ID3") {
		return 0;
	}
	const size =
		((bytes[6] ?? 0) & 0x7f) * 0x200000 +
		((bytes[7] ?? 0) & 0x7f) * 0x4000 +
		((bytes[8] ?? 0) & 0x7f) * 0x80 +
		((bytes[9] ?? 0) & 0x7f);
	return 10 + size;
}

/**
 * Estimates an MP3 byte stream's duration from its first frame header's
 * bitrate. Returns `null` when no syntactically valid frame sync is found
 * within `MP3_SYNC_SEARCH_WINDOW_BYTES` — callers fall through to the
 * word-count heuristic rather than trust a guess.
 */
export function estimateMp3DurationSeconds(bytes: Uint8Array): number | null {
	const audioStart = skipId3v2Tag(bytes);
	const header = parseMp3FirstFrameHeader(bytes, audioStart);
	if (!header) {
		return null;
	}

	const audioByteLength = bytes.length - audioStart;
	const bitrateBitsPerSecond = header.bitrateKbps * 1000;
	if (audioByteLength <= 0 || bitrateBitsPerSecond <= 0) {
		return null;
	}
	return (audioByteLength * 8) / bitrateBitsPerSecond;
}

// ---------------------------------------------------------------------------
// Word-count fallback — only reached when neither header parses (an
// unrecognized/corrupt format). Deliberately conservative: a faster-than-
// average words/sec biases the ESTIMATE short, so a genuinely borderline
// clip is more likely to be excluded from Seedance's reference-audio slot
// (degrading to prompt-spoken dialogue) than mistakenly trusted as long
// enough — the failure mode this whole guard exists to avoid is a hard
// 4xx on the scene's video task, which is far worse than losing lip-sync.
// ---------------------------------------------------------------------------

const CONSERVATIVE_WORDS_PER_SECOND = 2.8;

export function estimateWordCountDurationSeconds(text: string): number {
	const words = text.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) {
		return 0;
	}
	return words.length / CONSERVATIVE_WORDS_PER_SECOND;
}

/**
 * Resolves a TTS asset's duration from its downloaded bytes: WAV header
 * math first, then an MP3 frame estimate, then (only if `dialogueText` is
 * given) the word-count heuristic. `null` means genuinely nothing could be
 * determined — callers should leave `metadata.durationSeconds` unset rather
 * than persist a fabricated value (matches `isReferenceAudioDurationValid`'s
 * existing "unknown duration is treated as valid" default).
 */
export function resolveAudioDurationSeconds(args: {
	bytes: Uint8Array;
	dialogueText?: string | null;
}): AudioDurationResult | null {
	const wavSeconds = parseWavDurationSeconds(args.bytes);
	if (wavSeconds !== null) {
		return { durationSeconds: wavSeconds, method: "wav-header" };
	}

	const mp3Seconds = estimateMp3DurationSeconds(args.bytes);
	if (mp3Seconds !== null) {
		return { durationSeconds: mp3Seconds, method: "mp3-frame-estimate" };
	}

	if (args.dialogueText) {
		return {
			durationSeconds: estimateWordCountDurationSeconds(args.dialogueText),
			method: "word-count-heuristic",
		};
	}

	return null;
}

// ---------------------------------------------------------------------------
// Reference-audio duration guard — moved here (from generation.service.ts)
// so the guard itself is testable: it's pure, but generation.service.ts
// imports `@video-platform-challenge/db`/env, which resolves
// `cloudflare:workers` at module load and can't be imported under plain
// `bun test`. Re-exported from generation.service.ts unchanged (same
// pattern as lib/fail-reason.ts's `formatFailReason`) so every existing
// call site keeps using `generationService.isReferenceAudioDurationValid`.
// ---------------------------------------------------------------------------

// seedance-2-mini's documented bound on `reference_audio_urls` (kie.ai
// verified facts, packages/kie/src/video.ts): each clip 2-15s. Also bounded
// by the scene's own durationSeconds — a reference track longer than the
// clip it's lip-syncing makes no sense.
const REFERENCE_AUDIO_MIN_SECONDS = 2;
const REFERENCE_AUDIO_MAX_SECONDS = 15;

/**
 * Duration guard for using a TTS asset as Seedance's lip-sync reference
 * audio (architecture/v2-voice-pipeline). GEN-3 (docs ai-architecture-v1.md
 * §5 finding 3): `generation.service.ts::ingestSceneSpeech` now populates
 * `asset.metadata.durationSeconds` from the real downloaded bytes (via
 * `resolveAudioDurationSeconds` above), so this guard is no longer a
 * documented no-op — a sub-2-second clip ("Goal!") is correctly EXCLUDED
 * here, degrading that scene to prompt-spoken dialogue
 * (`createSceneVideoTask`'s own fallback wording) instead of reaching
 * Seedance and hard-failing as a non-retryable 4xx. An asset ingested before
 * this fix (or one whose duration genuinely couldn't be parsed) still has no
 * `durationSeconds` — `undefined` is still treated as valid, matching the
 * pre-fix behavior for that case specifically.
 */
export function isReferenceAudioDurationValid(
	asset: { metadata: AssetMetadata | null },
	maxDurationSeconds: number,
): boolean {
	const durationSeconds = asset.metadata?.durationSeconds;
	if (durationSeconds === undefined) {
		return true;
	}
	return (
		durationSeconds >= REFERENCE_AUDIO_MIN_SECONDS &&
		durationSeconds <= REFERENCE_AUDIO_MAX_SECONDS &&
		durationSeconds <= maxDurationSeconds
	);
}
