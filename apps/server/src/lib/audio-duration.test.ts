import { describe, expect, test } from "bun:test";

import {
	estimateMp3DurationSeconds,
	estimateWordCountDurationSeconds,
	isReferenceAudioDurationValid,
	parseWavDurationSeconds,
	resolveAudioDurationSeconds,
} from "./audio-duration";

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
	for (let i = 0; i < text.length; i++) {
		bytes[offset + i] = text.charCodeAt(i);
	}
}

/** Builds a minimal, well-formed PCM WAV buffer (RIFF/fmt /data, no extra chunks) with `dataBytes` bytes of silence. */
function buildWavBuffer(args: {
	sampleRate: number;
	channels: number;
	bitsPerSample: number;
	dataBytes: number;
}): Uint8Array {
	const { sampleRate, channels, bitsPerSample, dataBytes } = args;
	const blockAlign = channels * (bitsPerSample / 8);
	const byteRate = sampleRate * blockAlign;
	const fmtChunkSize = 16;
	const riffChunkSize = 4 + (8 + fmtChunkSize) + (8 + dataBytes);

	const bytes = new Uint8Array(8 + riffChunkSize);
	const view = new DataView(bytes.buffer);

	writeAscii(bytes, 0, "RIFF");
	view.setUint32(4, riffChunkSize, true);
	writeAscii(bytes, 8, "WAVE");

	writeAscii(bytes, 12, "fmt ");
	view.setUint32(16, fmtChunkSize, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, channels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);

	writeAscii(bytes, 36, "data");
	view.setUint32(40, dataBytes, true);
	// data payload left zero-filled (silence) — bytes.length already sized for it.

	return bytes;
}

/** MPEG1 Layer III, no CRC, 128kbps, 44100Hz — the real-world "FF FB 90 xx" frame sync every 128kbps/44.1kHz MP3 opens with. */
const MP3_128KBPS_44100HZ_HEADER = [0xff, 0xfb, 0x90, 0x00];

function buildMp3Buffer(totalBytes: number): Uint8Array {
	const bytes = new Uint8Array(totalBytes);
	bytes.set(MP3_128KBPS_44100HZ_HEADER, 0);
	return bytes;
}

function buildId3v2Header(tagBodySize: number): Uint8Array {
	const bytes = new Uint8Array(10);
	writeAscii(bytes, 0, "ID3");
	bytes[3] = 3; // version
	bytes[4] = 0; // revision
	bytes[5] = 0; // flags
	// Synchsafe 28-bit size, big-endian 7-bit-per-byte.
	bytes[6] = (tagBodySize >> 21) & 0x7f;
	bytes[7] = (tagBodySize >> 14) & 0x7f;
	bytes[8] = (tagBodySize >> 7) & 0x7f;
	bytes[9] = tagBodySize & 0x7f;
	return bytes;
}

describe("parseWavDurationSeconds", () => {
	test("computes exact duration for a 1s mono 16-bit 44.1kHz clip", () => {
		const byteRate = 44100 * 1 * 2;
		const wav = buildWavBuffer({
			bitsPerSample: 16,
			channels: 1,
			dataBytes: byteRate, // exactly 1 second
			sampleRate: 44100,
		});
		expect(parseWavDurationSeconds(wav)).toBeCloseTo(1, 9);
	});

	test("computes a sub-2-second clip correctly (the guard's actual use case)", () => {
		const byteRate = 44100 * 1 * 2;
		const dataBytes = Math.round(byteRate * 0.8);
		const wav = buildWavBuffer({
			bitsPerSample: 16,
			channels: 1,
			dataBytes,
			sampleRate: 44100,
		});
		expect(parseWavDurationSeconds(wav)).toBeCloseTo(0.8, 3);
	});

	test("handles stereo/higher sample rate correctly", () => {
		const byteRate = 48000 * 2 * 2;
		const wav = buildWavBuffer({
			bitsPerSample: 16,
			channels: 2,
			dataBytes: byteRate * 2, // 2 seconds
			sampleRate: 48000,
		});
		expect(parseWavDurationSeconds(wav)).toBeCloseTo(2, 9);
	});

	test("returns null for a non-RIFF buffer", () => {
		expect(parseWavDurationSeconds(new Uint8Array([1, 2, 3, 4]))).toBeNull();
	});

	test("returns null for a RIFF buffer missing a data chunk", () => {
		const bytes = new Uint8Array(20);
		writeAscii(bytes, 0, "RIFF");
		writeAscii(bytes, 8, "WAVE");
		expect(parseWavDurationSeconds(bytes)).toBeNull();
	});
});

describe("estimateMp3DurationSeconds", () => {
	test("estimates duration from the first frame's bitrate (CBR)", () => {
		// 16000 bytes @ 128kbps = exactly 1 second.
		const mp3 = buildMp3Buffer(16000);
		expect(estimateMp3DurationSeconds(mp3)).toBeCloseTo(1, 9);
	});

	test("skips a leading ID3v2 tag before scanning for the frame sync", () => {
		const tag = buildId3v2Header(20);
		const audio = buildMp3Buffer(16000);
		const combined = new Uint8Array(tag.length + 20 + audio.length);
		combined.set(tag, 0);
		// 20 bytes of arbitrary tag body content.
		combined.set(audio, tag.length + 20);

		expect(estimateMp3DurationSeconds(combined)).toBeCloseTo(1, 9);
	});

	test("returns null when no valid frame sync exists", () => {
		expect(estimateMp3DurationSeconds(new Uint8Array(100))).toBeNull();
	});
});

describe("estimateWordCountDurationSeconds", () => {
	test("estimates from word count at the conservative rate", () => {
		const text = "Goal! What a strike from outside the box!"; // 8 words
		const seconds = estimateWordCountDurationSeconds(text);
		expect(seconds).toBeCloseTo(8 / 2.8, 9);
	});

	test("returns 0 for empty/whitespace-only text", () => {
		expect(estimateWordCountDurationSeconds("   ")).toBe(0);
	});
});

describe("resolveAudioDurationSeconds", () => {
	test("prefers the WAV header when the buffer is a well-formed WAV", () => {
		const wav = buildWavBuffer({
			bitsPerSample: 16,
			channels: 1,
			dataBytes: 44100 * 2,
			sampleRate: 44100,
		});
		const result = resolveAudioDurationSeconds({ bytes: wav });
		expect(result).not.toBeNull();
		expect(result?.method).toBe("wav-header");
		expect(result?.durationSeconds).toBeCloseTo(1, 9);
	});

	test("falls back to the MP3 estimate when it's not a WAV", () => {
		const mp3 = buildMp3Buffer(16000);
		const result = resolveAudioDurationSeconds({ bytes: mp3 });
		expect(result?.method).toBe("mp3-frame-estimate");
		expect(result?.durationSeconds).toBeCloseTo(1, 9);
	});

	test("falls back to the word-count heuristic when neither header parses", () => {
		const garbage = new Uint8Array(50);
		const result = resolveAudioDurationSeconds({
			bytes: garbage,
			dialogueText: "Goal!",
		});
		expect(result?.method).toBe("word-count-heuristic");
		expect(result?.durationSeconds).toBeCloseTo(1 / 2.8, 9);
	});

	test("returns null when nothing parses and no dialogue text is given", () => {
		const garbage = new Uint8Array(50);
		expect(resolveAudioDurationSeconds({ bytes: garbage })).toBeNull();
	});
});

describe("isReferenceAudioDurationValid", () => {
	test("excludes a sub-2-second clip (the actual bug: 'Goal!' reaching Seedance)", () => {
		expect(
			isReferenceAudioDurationValid({ metadata: { durationSeconds: 0.8 } }, 5),
		).toBe(false);
	});

	test("excludes a clip over Seedance's 15s reference-audio bound", () => {
		expect(
			isReferenceAudioDurationValid({ metadata: { durationSeconds: 16 } }, 20),
		).toBe(false);
	});

	test("excludes a clip longer than the scene it would lip-sync", () => {
		expect(
			isReferenceAudioDurationValid({ metadata: { durationSeconds: 4 } }, 3),
		).toBe(false);
	});

	test("accepts a clip within [2, 15]s and within the scene's own duration", () => {
		expect(
			isReferenceAudioDurationValid({ metadata: { durationSeconds: 3.2 } }, 5),
		).toBe(true);
	});

	test("treats an unknown duration as valid (asset ingested before this fix, or unparseable)", () => {
		expect(isReferenceAudioDurationValid({ metadata: null }, 5)).toBe(true);
		expect(isReferenceAudioDurationValid({ metadata: {} }, 5)).toBe(true);
	});
});
