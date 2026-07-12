import type {
	Scene,
	SubtitleStyle,
	TimelineEntry,
} from "@video-platform-challenge/api";
import { SceneStatus } from "@video-platform-challenge/types";
import {
	AUDIO_CODECS,
	type AudioEncodingConfig,
	AudioSampleSink,
	AudioSampleSource,
	BufferTarget,
	EncodedAudioPacketSource,
	EncodedPacketSink,
	getFirstEncodableAudioCodec,
	getFirstEncodableVideoCodec,
	Input,
	type InputAudioTrack,
	type InputVideoTrack,
	MP4,
	Mp4OutputFormat,
	Output,
	QTFF,
	QUALITY_HIGH,
	UrlSource,
	VIDEO_CODECS,
	type VideoEncodingConfig,
	VideoSampleSink,
	VideoSampleSource,
} from "mediabunny";

import {
	defaultTrimWindow,
	isBeforeTrimWindow,
	isPastTrimWindow,
	shiftIntoOutputTimeline,
	type TrimWindow,
	trimWindowDurationSeconds,
} from "@/feature/studio/lib/export-trim-window";
import {
	drawSubtitle,
	STUDIO_BACKDROP_COLOR,
} from "@/feature/studio/lib/subtitle-canvas";

/**
 * Thrown by `exportProjectVideo` BEFORE any network call when a timeline
 * entry points at a scene that hasn't finished generating a video yet (docs
 * §9's per-scene readiness gate — SCOPE item 4 of this phase). Carries the
 * 1-based position so the UI/toast can name the scene without re-deriving it.
 */
export class SceneNotReadyError extends Error {
	readonly scenePosition: number;

	constructor(scenePosition: number, sceneTitle: string | null) {
		super(
			`Scene ${scenePosition}${sceneTitle ? ` ("${sceneTitle}")` : ""} has no video yet.`,
		);
		this.name = "SceneNotReadyError";
		this.scenePosition = scenePosition;
	}
}

/** Thrown when `signal` fires mid-export — mirrors Mediabunny's own `ConversionCanceledError` shape for a consistent catch pattern in the caller. */
export class ExportCanceledError extends Error {
	constructor() {
		super("Export was canceled.");
		this.name = "ExportCanceledError";
	}
}

/** Thrown when a scene's video track can't be read/decoded at all — distinct from `SceneNotReadyError` (this is a corrupt/unsupported asset, not a pipeline-timing issue). */
export class SceneVideoUnreadableError extends Error {
	constructor(scenePosition: number, reason: string) {
		super(`Scene ${scenePosition}'s video could not be read (${reason}).`);
		this.name = "SceneVideoUnreadableError";
	}
}

/** Thrown when the draft timeline has zero scenes — distinct from `SceneNotReadyError`, which names a specific unready scene. */
export class EmptyTimelineError extends Error {
	constructor() {
		super("This project has no scenes to export.");
		this.name = "EmptyTimelineError";
	}
}

export type ExportStage = "fetching" | "muxing";

export type ExportProgress = {
	/** 0..1 overall completion across every scene. */
	fraction: number;
	sceneIndex: number;
	sceneCount: number;
	stage: ExportStage;
};

/** Resolves an asset id to a signed, fetchable GET URL. A plain async function (not a hook) so this module — a lib, not a component — stays callable outside React (docs SCOPE item 1: "hooks don't work in a lib"). The real implementation wraps `orpcClient.assets.getDownloadUrl`. */
export type GetAssetUrl = (assetId: string) => Promise<string>;

export type ExportProjectVideoParams = {
	scenesById: Record<string, Scene>;
	timeline: TimelineEntry[];
	/** Burned into every frame of the export via `drawSubtitle` — the exact object the Player's `SubtitleOverlay` renders live, so a version's export always matches what Studio last showed (see `subtitle-canvas.ts`'s parity derivation). */
	subtitleStyle: SubtitleStyle;
	getAssetUrl: GetAssetUrl;
	onProgress?: (progress: ExportProgress) => void;
	signal?: AbortSignal;
};

/**
 * One probed scene: its Input, the primary tracks the mux loop reads from,
 * and the two pieces of per-scene metadata the re-encode/burn-in pass needs
 * that live outside the Mediabunny track objects — `subtitleText` (which
 * caption to draw while this scene's frames are on screen) and
 * `durationSeconds` (the timeline's own authored length, used to turn a
 * frame's relative timestamp into an intra-scene progress fraction).
 */
type ProbedScene = {
	scenePosition: number;
	input: Input;
	videoTrack: InputVideoTrack;
	audioTrack: InputAudioTrack | null;
	subtitleText: string | null;
	durationSeconds: number;
};

type AudioPipeline =
	| { strategy: "copy"; source: EncodedAudioPacketSource }
	| { strategy: "reencode"; source: AudioSampleSource }
	| { strategy: "none" };

function throwIfAborted(signal: AbortSignal | undefined) {
	if (signal?.aborted) {
		throw new ExportCanceledError();
	}
}

/**
 * Guard rail (SCOPE item 1): every timeline entry must point at a scene whose
 * generation actually finished, checked BEFORE any network call. `entry.
 * videoAssetId` is the source of truth for the asset id (project.service.ts
 * seeds it `""` for a not-yet-generated scene, docs §6's timeline shape) —
 * `scene.status` is the human-readable reason surfaced in the error.
 */
function validateTimelineReady(
	timeline: TimelineEntry[],
	scenesById: Record<string, Scene>,
): void {
	timeline.forEach((entry, index) => {
		const scene = scenesById[entry.sceneId];
		const ready =
			scene !== undefined &&
			scene.status === SceneStatus.VIDEO_READY &&
			entry.videoAssetId.length > 0;
		if (!ready) {
			throw new SceneNotReadyError(index + 1, scene?.title ?? null);
		}
	});
}

/** Every asset this lib ever reads is an MP4 (Seedance scene clips, or a previously uploaded `render` asset) — QTFF (QuickTime/.mov) is included too since it shares the ISOBMFF box structure and some encoders label their MP4 output that way. Scoping the demuxer set (instead of `ALL_FORMATS`) keeps this module's bundle lean without losing anything a real input needs. */
const INPUT_FORMATS = [MP4, QTFF];

/** Opens one signed URL as a Mediabunny `Input`, resolves its primary video/audio tracks, and carries the scene's own subtitle text + authored duration through to the mux loop (the burn-in pass needs both alongside the decoded frames). */
async function probeScene(
	entry: TimelineEntry,
	scenePosition: number,
	scenesById: Record<string, Scene>,
	getAssetUrl: GetAssetUrl,
	signal: AbortSignal | undefined,
): Promise<ProbedScene> {
	throwIfAborted(signal);
	const url = await getAssetUrl(entry.videoAssetId);
	throwIfAborted(signal);

	const input = new Input({
		formats: INPUT_FORMATS,
		source: new UrlSource(url),
	});

	const videoTrack = await input.getPrimaryVideoTrack();
	if (!videoTrack) {
		input.dispose();
		throw new SceneVideoUnreadableError(scenePosition, "no video track found");
	}
	const codec = await videoTrack.getCodec();
	if (!codec) {
		input.dispose();
		throw new SceneVideoUnreadableError(
			scenePosition,
			"unrecognized video codec",
		);
	}

	const audioTrack = await input.getPrimaryAudioTrack();
	const subtitleText = scenesById[entry.sceneId]?.subtitleText ?? null;

	return {
		audioTrack,
		durationSeconds: entry.durationSeconds,
		input,
		scenePosition,
		subtitleText,
		videoTrack,
	};
}

/** Whether every probed scene HAS an audio track AND they share codec/channels/sample rate. Scenes missing audio entirely fall back to a silent export track (documented limitation — see `exportProjectVideo`'s doc comment) rather than half-muxed gaps. */
async function canCopyAudio(
	scenes: ProbedScene[],
): Promise<"copy" | "reencode" | "none"> {
	if (scenes.some((s) => s.audioTrack === null)) {
		return "none";
	}
	const tracks = scenes.map((s) => s.audioTrack as InputAudioTrack);
	const infos = await Promise.all(
		tracks.map(async (track) => ({
			channels: await track.getNumberOfChannels(),
			codec: await track.getCodec(),
			sampleRate: await track.getSampleRate(),
		})),
	);
	const first = infos[0];
	const allMatch =
		first !== undefined &&
		infos.every(
			(info) =>
				info.codec === first.codec &&
				info.channels === first.channels &&
				info.sampleRate === first.sampleRate,
		);
	return allMatch ? "copy" : "reencode";
}

function roundUpToEven(value: number): number {
	return value % 2 === 0 ? value : value + 1;
}

/**
 * Audio counterpart of `reencodeVideoScene`'s packet-level twin below —
 * identical shape, kept separate rather than genericized over Video/Audio
 * types since `EncodedVideoChunkMetadata`/`EncodedAudioChunkMetadata` aren't
 * structurally interchangeable in strict mode.
 *
 * REN-1: stops copying packets once past `window.end` (a clip generated even
 * a fraction of a second longer than its authored duration must not leak
 * into the next scene's audio) — the caller advances the shared offset by
 * `trimWindowDurationSeconds(window)`, never by whatever this actually
 * copied, so the two can never drift apart. Also skips (does not `break`,
 * just `continue`s past) any packet BEFORE `window.start` — see
 * export-trim-window.ts's doc comment: with `trimStart` always 0 today this
 * never actually skips anything (no packet precedes t=0), it only closes the
 * latent bug for a future nonzero `trimStart`.
 */
async function copyAudioScene(
	scene: ProbedScene,
	source: EncodedAudioPacketSource,
	baseOffsetSeconds: number,
	sendDecoderConfig: boolean,
	window: TrimWindow,
	signal: AbortSignal | undefined,
): Promise<void> {
	const track = scene.audioTrack;
	if (!track) {
		return;
	}

	const sink = new EncodedPacketSink(track);
	const decoderConfig = await track.getDecoderConfig();
	const firstTimestamp = Math.max(await track.getFirstTimestamp(), 0);

	let sentMeta = !sendDecoderConfig;

	for await (const packet of sink.packets()) {
		throwIfAborted(signal);
		const relativeTimestamp = packet.timestamp - firstTimestamp;
		if (isPastTrimWindow(relativeTimestamp, window)) {
			break;
		}
		if (isBeforeTrimWindow(relativeTimestamp, window)) {
			continue;
		}

		const shifted = packet.clone({
			timestamp: shiftIntoOutputTimeline(
				relativeTimestamp,
				window,
				baseOffsetSeconds,
			),
		});
		await source.add(
			shifted,
			sentMeta ? undefined : { decoderConfig: decoderConfig ?? undefined },
		);
		sentMeta = true;
	}
}

/** How many decoded video frames pass between intra-scene progress ticks — frequent enough for a smooth progress bar during the (now mandatory) re-encode, coarse enough not to spam `onProgress`/React state updates. */
const FRAME_PROGRESS_BATCH = 5;

/**
 * Decode + re-encode one scene's video (Mediabunny's `VideoSampleSink` /
 * `VideoSampleSource`, the ONLY video path now — see `exportProjectVideo`'s
 * doc comment). Every decoded sample is timestamp-shifted onto the shared
 * output timeline exactly as before; the actual subtitle burn-in happens
 * inside `source`'s own `transform.process` hook (built once in
 * `buildVideoPipeline`), which reads `subtitleTextRef.current` — set here,
 * once per scene, before that scene's frames start flowing through `source`.
 * Since scenes are muxed strictly sequentially (the caller `await`s this
 * function to completion before starting the next scene), the ref is always
 * correct for whichever frame `process` is currently handling.
 *
 * REN-1 (docs ai-architecture-v1.md §5 finding 1): stops decoding/muxing
 * samples once past `window.end` — this is the actual fix for the
 * export/Player duration drift, since the Player hard-cuts every scene at
 * its authored `durationSeconds` (Remotion `Sequence`) the same way. The
 * caller advances the shared mux offset by `trimWindowDurationSeconds(window)`
 * (the AUTHORED duration), never by how much this function actually decoded.
 * Also skips (does not `break`, just `continue`s past, after closing the
 * decoded sample) any frame BEFORE `window.start` — see
 * export-trim-window.ts's doc comment: with `trimStart` always 0 today this
 * never actually skips a frame (no frame precedes t=0), it only closes the
 * latent bug for a future nonzero `trimStart`.
 */
async function reencodeVideoScene(
	scene: ProbedScene,
	source: VideoSampleSource,
	baseOffsetSeconds: number,
	subtitleTextRef: { current: string | null },
	window: TrimWindow,
	onFrameProgress: ((relativeTimestampSeconds: number) => void) | undefined,
	signal: AbortSignal | undefined,
): Promise<void> {
	subtitleTextRef.current = scene.subtitleText;

	const sink = new VideoSampleSink(scene.videoTrack);
	const firstTimestamp = Math.max(
		await scene.videoTrack.getFirstTimestamp(),
		0,
	);

	let frameCount = 0;
	for await (const sample of sink.samples()) {
		throwIfAborted(signal);
		const relativeTimestamp = Math.max(sample.timestamp - firstTimestamp, 0);
		if (isPastTrimWindow(relativeTimestamp, window)) {
			sample.close();
			break;
		}
		if (isBeforeTrimWindow(relativeTimestamp, window)) {
			sample.close();
			continue;
		}

		sample.setTimestamp(
			shiftIntoOutputTimeline(relativeTimestamp, window, baseOffsetSeconds),
		);
		await source.add(sample);
		sample.close();

		frameCount += 1;
		if (frameCount % FRAME_PROGRESS_BATCH === 0) {
			onFrameProgress?.(relativeTimestamp);
		}
	}
}

/**
 * Decode + re-encode fallback for audio, mirroring the video path's shape
 * (used only when scenes' audio tracks disagree on codec/channels/rate —
 * see `canCopyAudio`). REN-1: same window clamp as `reencodeVideoScene`/
 * `copyAudioScene` — stops past `window.end`, never advances the caller's
 * offset itself (see `trimWindowDurationSeconds`). Also skips (does not
 * `break`, just `continue`s past, after closing the decoded sample) any
 * sample BEFORE `window.start` — see export-trim-window.ts's doc comment:
 * with `trimStart` always 0 today this never actually skips a sample, it
 * only closes the latent bug for a future nonzero `trimStart`.
 */
async function reencodeAudioScene(
	scene: ProbedScene,
	source: AudioSampleSource,
	baseOffsetSeconds: number,
	window: TrimWindow,
	signal: AbortSignal | undefined,
): Promise<void> {
	const track = scene.audioTrack;
	if (!track) {
		return;
	}

	const sink = new AudioSampleSink(track);
	const firstTimestamp = Math.max(await track.getFirstTimestamp(), 0);

	for await (const sample of sink.samples()) {
		throwIfAborted(signal);
		const relativeTimestamp = Math.max(sample.timestamp - firstTimestamp, 0);
		if (isPastTrimWindow(relativeTimestamp, window)) {
			sample.close();
			break;
		}
		if (isBeforeTrimWindow(relativeTimestamp, window)) {
			sample.close();
			continue;
		}

		sample.setTimestamp(
			shiftIntoOutputTimeline(relativeTimestamp, window, baseOffsetSeconds),
		);
		await source.add(sample);
		sample.close();
	}
}

/**
 * Builds the (now single) video pipeline: a `VideoSampleSource` whose
 * `transform` locks every frame to scene 0's (rounded-to-even) dimensions —
 * mismatched scene sizes letterbox via `fit: "contain"`, same as before — and
 * whose `transform.process` hook is Mediabunny's own sanctioned "apply an
 * overlay" mechanism. Per Mediabunny's `VideoSampleSource` implementation
 * (`media-source.ts`), `process` receives each sample AFTER the
 * width/height/fit resize already ran, so `sample.displayWidth/Height` here
 * ALWAYS equal the final output frame size — the exact coordinate space
 * `drawSubtitle`'s parity math needs, no separate "what's the output size"
 * plumbing required.
 *
 * One `OffscreenCanvas` is allocated ONCE for the whole export and reused
 * every frame: Mediabunny's own `VideoSample` constructor immediately copies
 * (`context.drawImage`) whatever `CanvasImageSource` `process` returns into
 * its OWN internal canvas before encoding, so reusing (and re-clearing) a
 * single canvas across frames is safe — this mirrors Mediabunny's own
 * `transform()` implementation, which pools canvases the same way.
 *
 * Overlay CSS → canvas parity table (composition.tsx's `SubtitleOverlay` on
 * the left, `drawSubtitle` in subtitle-canvas.ts on the right):
 *
 * | Overlay (CSS)                                            | Canvas (`drawSubtitle`)                                   |
 * |-----------------------------------------------------------|-------------------------------------------------------------|
 * | `fontSize: style.fontSize ?? 48` (px in the FIXED 1920×1080/1080×1920 composition box) | `(style.fontSize ?? 48) * scaleRatio`, `scaleRatio = sqrt(videoW*videoH / (1920*1080))` |
 * | `fontWeight` ternary: bold→700, medium→600, else→400      | identical ternary                                            |
 * | `WebkitTextStroke: 2px outlineColor` (always on, default `#000000`) | `ctx.lineWidth = 2 * scaleRatio`; `strokeText` before `fillText` |
 * | `color: style.color ?? "#ffffff"`                          | `ctx.fillStyle`                                              |
 * | `backgroundColor` + `borderRadius: 10` + `padding: "0.35em 0.7em"` (only when set) | rounded rect (`traceRoundedRectPath`) sized to the wrapped text block + `0.35×/0.7×fontSizePx` padding, radius `10 * scaleRatio` |
 * | `padding: "5% 6%"` on the AbsoluteFill (CSS resolves padding-top/bottom against WIDTH, not height — CSS2.1 §8.4) | both safe margins computed as `videoWidth * 0.05` / `videoWidth * 0.06` |
 * | `maxWidth: "90%"` of the post-padding content box          | `(videoWidth - 2*horizontalMargin) * 0.9`                    |
 * | `justifyContent`: top→`flex-start`, else→`flex-end`        | `boxTop = margin` or `videoHeight - margin - boxHeight`       |
 * | `alignItems: "center"` (horizontal, column-direction AbsoluteFill) | `centerX = videoWidth / 2`                                    |
 * | `textAlign: "center"`, implicit browser line-wrap          | `ctx.textAlign = "center"`; `measureText`-loop word-wrap, `lineHeight = fontSizePx * 1.2` |
 */
async function buildVideoPipeline(
	probed: ProbedScene[],
	output: Output,
	subtitleStyle: SubtitleStyle,
	subtitleTextRef: { current: string | null },
): Promise<VideoSampleSource> {
	const first = probed[0];
	if (!first) {
		throw new EmptyTimelineError();
	}

	const width = roundUpToEven(await first.videoTrack.getSquarePixelWidth());
	const height = roundUpToEven(await first.videoTrack.getSquarePixelHeight());
	const supportedCodecs = output.format.getSupportedVideoCodecs();
	const codec = await getFirstEncodableVideoCodec(
		supportedCodecs.length > 0 ? supportedCodecs : [...VIDEO_CODECS],
		{ bitrate: QUALITY_HIGH, height, width },
	);
	if (!codec) {
		throw new SceneVideoUnreadableError(
			first.scenePosition,
			"no video codec this browser can encode",
		);
	}

	const compositeCanvas = new OffscreenCanvas(width, height);
	const compositeCtx = compositeCanvas.getContext("2d");
	if (!compositeCtx) {
		throw new SceneVideoUnreadableError(
			first.scenePosition,
			"2D canvas context unavailable for subtitle burn-in",
		);
	}

	const encodingConfig: VideoEncodingConfig = {
		bitrate: QUALITY_HIGH,
		codec,
		sizeChangeBehavior: "passThrough",
		transform: {
			fit: "contain",
			height,
			process: (sample) => {
				compositeCtx.fillStyle = STUDIO_BACKDROP_COLOR;
				compositeCtx.fillRect(0, 0, width, height);
				sample.draw(compositeCtx, 0, 0);
				drawSubtitle(compositeCtx, {
					style: subtitleStyle,
					text: subtitleTextRef.current,
					videoHeight: height,
					videoWidth: width,
				});
				return compositeCanvas;
			},
			width,
		},
	};
	return new VideoSampleSource(encodingConfig);
}

/**
 * Decides and builds the audio pipeline. Returns `{ strategy: "none" }`
 * (video-only export) when any scene is missing an audio track — see
 * `canCopyAudio`'s doc comment for why gaps aren't attempted.
 */
async function buildAudioPipeline(
	probed: ProbedScene[],
	output: Output,
): Promise<AudioPipeline> {
	const strategy = await canCopyAudio(probed);
	if (strategy === "none") {
		return { strategy: "none" };
	}

	const first = probed[0]?.audioTrack;
	if (!first) {
		return { strategy: "none" };
	}

	if (strategy === "copy") {
		const codec = await first.getCodec();
		if (!codec) {
			return { strategy: "none" };
		}
		return { source: new EncodedAudioPacketSource(codec), strategy: "copy" };
	}

	const numberOfChannels = await first.getNumberOfChannels();
	const sampleRate = await first.getSampleRate();
	const supportedCodecs = output.format.getSupportedAudioCodecs();
	const codec = await getFirstEncodableAudioCodec(
		supportedCodecs.length > 0 ? supportedCodecs : [...AUDIO_CODECS],
		{ bitrate: QUALITY_HIGH, numberOfChannels, sampleRate },
	);
	if (!codec) {
		// No encodable audio codec available — ship video-only rather than failing the whole export.
		return { strategy: "none" };
	}
	const encodingConfig: AudioEncodingConfig = {
		bitrate: QUALITY_HIGH,
		codec,
		transform: { numberOfChannels, sampleRate },
	};
	return {
		source: new AudioSampleSource(encodingConfig),
		strategy: "reencode",
	};
}

/**
 * Client-side render engine for the export flow. Resolves each timeline
 * entry's video asset to a signed URL, feeds the clips into Mediabunny in
 * timeline order, and produces one MP4 `Blob` with the project's subtitles
 * burned into every frame exactly as styled in Studio (the acceptance bar: a
 * frame exported at time T must look like the Player paused at time T — see
 * the parity table on `buildVideoPipeline`).
 *
 * Video is ALWAYS decoded and re-encoded now: a zero-decode packet copy
 * cannot draw pixels, so burning subtitles in retired that path entirely
 * (previously the default when scenes shared codec/dimensions). Audio is
 * unaffected — still a per-scene decision between a zero-re-encode packet
 * copy (when every scene's track shares codec/channels/rate) and a
 * decode+re-encode fallback, passthrough of each clip's OWN baked-in audio
 * either way (dialogue now arrives already mixed into the Seedance clips
 * server-side — no TTS/audio mixing happens in this module).
 *
 * Every scene must already be `video_ready` — `validateTimelineReady` throws
 * `SceneNotReadyError` before any network call if not. `signal` aborts
 * mid-flight: checked between every packet/sample, and on abort every opened
 * `Input` is disposed and the in-progress `Output` is canceled before
 * throwing.
 *
 * `document.fonts.ready` is awaited once, up front: canvas `fillText`/
 * `strokeText` silently fall back to the platform default font for any
 * family that hasn't finished loading yet (unlike CSS, which reflows once a
 * webfont arrives) — without this, a custom `subtitleStyle.font` could burn
 * in wrong on a fast machine that starts exporting before the font parses.
 */
export async function exportProjectVideo({
	scenesById,
	timeline,
	subtitleStyle,
	getAssetUrl,
	onProgress,
	signal,
}: ExportProjectVideoParams): Promise<Blob> {
	if (timeline.length === 0) {
		throw new EmptyTimelineError();
	}
	validateTimelineReady(timeline, scenesById);
	throwIfAborted(signal);

	await document.fonts.ready;
	throwIfAborted(signal);

	const sceneCount = timeline.length;
	const probed: ProbedScene[] = [];

	try {
		for (let i = 0; i < timeline.length; i++) {
			onProgress?.({
				fraction: i / sceneCount,
				sceneCount,
				sceneIndex: i,
				stage: "fetching",
			});
			const entry = timeline[i];
			if (!entry) {
				continue;
			}
			probed.push(
				await probeScene(entry, i + 1, scenesById, getAssetUrl, signal),
			);
		}

		const target = new BufferTarget();
		const output = new Output({ format: new Mp4OutputFormat(), target });

		const subtitleTextRef: { current: string | null } = { current: null };
		const videoSource = await buildVideoPipeline(
			probed,
			output,
			subtitleStyle,
			subtitleTextRef,
		);
		output.addVideoTrack(videoSource);

		const audioPipeline = await buildAudioPipeline(probed, output);
		if (audioPipeline.strategy !== "none") {
			output.addAudioTrack(audioPipeline.source);
		}

		await output.start();

		let videoOffset = 0;
		let audioOffset = 0;
		let audioMetaSent = false;

		for (let i = 0; i < probed.length; i++) {
			const scene = probed[i];
			if (!scene) {
				continue;
			}
			throwIfAborted(signal);
			onProgress?.({
				fraction: i / sceneCount,
				sceneCount,
				sceneIndex: i,
				stage: "muxing",
			});

			// REN-1: every scene's re-encoded/copied media clamps to this same
			// window — `[0, durationSeconds]` today (the whole authored clip),
			// a future `[trimStart, trimEnd]` once scenes-architecture-v3.md's
			// trim feature lands (see export-trim-window.ts's doc comment for
			// what actually changes here AND in the three mux loops below).
			const window = defaultTrimWindow(scene.durationSeconds);

			await reencodeVideoScene(
				scene,
				videoSource,
				videoOffset,
				subtitleTextRef,
				window,
				(relativeTimestampSeconds) => {
					const intraSceneFraction =
						scene.durationSeconds > 0
							? Math.min(1, relativeTimestampSeconds / scene.durationSeconds)
							: 1;
					onProgress?.({
						fraction: (i + intraSceneFraction) / sceneCount,
						sceneCount,
						sceneIndex: i,
						stage: "muxing",
					});
				},
				signal,
			);

			if (audioPipeline.strategy === "copy") {
				await copyAudioScene(
					scene,
					audioPipeline.source,
					audioOffset,
					!audioMetaSent,
					window,
					signal,
				);
				audioMetaSent = true;
			} else if (audioPipeline.strategy === "reencode") {
				await reencodeAudioScene(
					scene,
					audioPipeline.source,
					audioOffset,
					window,
					signal,
				);
			}

			// The AUTHORED duration, never the decoded clip length — this is
			// what keeps the export's timeline in lockstep with what the
			// Player showed (docs finding 1). Video and audio always advance
			// by the exact same amount now, since they share one window.
			const sceneDurationSeconds = trimWindowDurationSeconds(window);
			videoOffset += sceneDurationSeconds;
			audioOffset += sceneDurationSeconds;

			scene.input.dispose();
			onProgress?.({
				fraction: (i + 1) / sceneCount,
				sceneCount,
				sceneIndex: i,
				stage: "muxing",
			});
		}

		videoSource.close();
		if (audioPipeline.strategy !== "none") {
			audioPipeline.source.close();
		}

		await output.finalize();

		const buffer = target.buffer;
		if (!buffer) {
			throw new Error("Export produced no output buffer.");
		}
		return new Blob([buffer], { type: "video/mp4" });
	} catch (error) {
		for (const scene of probed) {
			scene.input.dispose();
		}
		throw error;
	}
}
