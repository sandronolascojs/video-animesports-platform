"use client";

/**
 * Letterbox-blur media wells: the media well is ALWAYS 16:9 (MediaCard
 * contract), so portrait/9:16 content renders CONTAINED over a heavily
 * blurred cover copy of itself — the chat-input glass language (blur +
 * translucent card tint + hairline sheen) instead of bars or a crop.
 * Landscape 16:9 content fills the well and simply hides the backdrop.
 * The blur is a painted copy, NOT backdrop-filter — Chromium doesn't
 * attenuate backdrop filters through masks, and a plain filtered copy is
 * cheaper anyway.
 */

function FrostBackdrop({ children }: { children: React.ReactNode }) {
	return (
		<div aria-hidden className="absolute inset-0 overflow-hidden">
			{children}
			{/* glass-composer tint language over the blur. */}
			<div className="absolute inset-0 bg-card/40" />
			<div className="absolute inset-0 bg-[linear-gradient(124deg,rgb(255_255_255/0.04)_22%,rgb(255_255_255/0.06)_51%,rgb(255_255_255/0.02)_80%)]" />
		</div>
	);
}

export function FrostedImage({ src, alt }: { src: string; alt: string }) {
	return (
		<>
			<FrostBackdrop>
				{/* biome-ignore lint/performance/noImgElement: signed R2 URLs are short-lived and per-asset — next/image's remote-loader allowlist doesn't fit this. */}
				<img
					src={src}
					alt=""
					className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl"
				/>
			</FrostBackdrop>
			{/* biome-ignore lint/performance/noImgElement: same signed-URL constraint. */}
			<img
				src={src}
				alt={alt}
				className="absolute inset-0 h-full w-full object-contain"
			/>
		</>
	);
}

export function FrostedVideo({
	src,
	controls = false,
}: {
	src: string;
	controls?: boolean;
}) {
	const nudge = (event: React.SyntheticEvent<HTMLVideoElement>) => {
		event.currentTarget.play().catch(() => {});
	};

	return (
		<>
			<FrostBackdrop>
				{/* Blurred twin — any playback desync disappears under blur-2xl. */}
				<video
					src={src}
					autoPlay
					muted
					loop
					playsInline
					className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl"
					onLoadedData={nudge}
				/>
			</FrostBackdrop>
			<video
				src={src}
				autoPlay
				muted={!controls}
				loop
				playsInline
				controls={controls}
				aria-hidden={!controls}
				className="absolute inset-0 h-full w-full object-contain"
				onLoadedData={nudge}
			/>
		</>
	);
}
