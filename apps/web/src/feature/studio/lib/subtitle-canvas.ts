import type { SubtitleStyle } from "@video-platform-challenge/api";
import type { AspectRatio } from "@video-platform-challenge/types";

/**
 * The Remotion composition's own fixed pixel coordinate space per aspect
 * ratio (`@remotion/player`'s `compositionWidth`/`compositionHeight`, owned
 * here and imported by `player-canvas.tsx` — declared ONCE so the Player and
 * the export burn-in can never drift apart). Every CSS px in
 * `remotion/composition.tsx`'s `SubtitleOverlay` (fontSize, the 2px
 * `WebkitTextStroke`, the 10px `borderRadius`) is defined relative to THIS
 * box — the Player then scales the whole composition uniformly to fit its
 * container, so those px values stay a constant fraction of frame height
 * regardless of display size. `drawSubtitle` re-derives that same fraction
 * against the real exported frame via `REFERENCE_AREA_PX` below.
 */
export const COMPOSITION_REFERENCE_DIMENSIONS: Record<
	AspectRatio,
	{ width: number; height: number }
> = {
	"16:9": { height: 1080, width: 1920 },
	"9:16": { height: 1920, width: 1080 },
};

/**
 * `1920×1080` and `1080×1920` cover the exact same pixel area
 * (2,073,600px²) — by design, both aspect ratios share one "resolution
 * budget". That means `sqrt(videoWidth * videoHeight) / sqrt(REFERENCE_AREA_PX)`
 * equals `videoHeight / 1080` for any 16:9-shaped frame AND `videoHeight /
 * 1920` for any 9:16-shaped frame (same algebraic identity, worked out from
 * the fixed aspect ratio) — i.e. this single area-based ratio reproduces the
 * per-aspect-ratio height-based scale factor WITHOUT `drawSubtitle` needing
 * to know which aspect ratio it's drawing, keeping its signature to exactly
 * `{ text, style, videoWidth, videoHeight }`.
 */
const REFERENCE_AREA_PX =
	COMPOSITION_REFERENCE_DIMENSIONS["16:9"].width *
	COMPOSITION_REFERENCE_DIMENSIONS["16:9"].height;

/** Matches `remotion/composition.tsx`'s `StudioComposition` root `AbsoluteFill` backdrop — shown behind any letterboxing when a scene's own dimensions don't match the export's locked output size. */
export const STUDIO_BACKDROP_COLOR = "#050505";

const DEFAULT_FONT_SIZE_PX = 48;
const DEFAULT_FONT_FAMILY = "Inter";
const DEFAULT_TEXT_COLOR = "#ffffff";
const DEFAULT_OUTLINE_COLOR = "#000000";

/** The overlay's `WebkitTextStroke` is hardcoded to `2px` (the schema has no outline-WIDTH field, only `outlineColor` — see `subtitles-panel.tsx`'s doc comment) — scaled by the same ratio as font size since it's also a raw px in the composition's coordinate space. */
const OUTLINE_WIDTH_REFERENCE_PX = 2;
/** Mirrors the overlay's `borderRadius: 10` (applied only when a background color is set). */
const BACKGROUND_RADIUS_REFERENCE_PX = 10;
/** CSS `line-height: normal`'s usual ~1.2× multiplier — the overlay never sets an explicit line-height, so this is the standard approximation for browser default line boxes. */
const LINE_HEIGHT_MULTIPLIER = 1.2;

type Canvas2DContext =
	| CanvasRenderingContext2D
	| OffscreenCanvasRenderingContext2D;

export type DrawSubtitleParams = {
	/** The active scene's subtitle line(s). Falsy (`null`/`""`) draws nothing — mirrors `SubtitleOverlay`'s `if (!text) return null`. */
	text: string | null;
	style: SubtitleStyle;
	/** The exact width, in px, of the canvas `ctx` is bound to. */
	videoWidth: number;
	/** The exact height, in px, of the canvas `ctx` is bound to. */
	videoHeight: number;
};

/** Traces a rounded-rectangle path via `arcTo` (not `ctx.roundRect`, which isn't reliably typed for `OffscreenCanvasRenderingContext2D` across TS/lib versions) — call `ctx.fill()` after. */
function traceRoundedRectPath(
	ctx: Canvas2DContext,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
): void {
	const r = Math.max(0, Math.min(radius, width / 2, height / 2));
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + width - r, y);
	ctx.arcTo(x + width, y, x + width, y + r, r);
	ctx.lineTo(x + width, y + height - r);
	ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
	ctx.lineTo(x + r, y + height);
	ctx.arcTo(x, y + height, x, y + height - r, r);
	ctx.lineTo(x, y + r);
	ctx.arcTo(x, y, x + r, y, r);
	ctx.closePath();
}

/**
 * Greedy word-wrap via a `measureText` loop (canvas has no native text
 * layout). Splits on whitespace runs — including literal `\n` — the same way
 * CSS `white-space: normal` collapses newlines to spaces in the overlay's
 * plain `<div>{text}</div>`, so a subtitle authored with manual line breaks
 * wraps identically in both places. A single word wider than `maxWidth` is
 * kept on its own (overflowing) line rather than character-broken — CSS
 * `overflow-wrap: normal` (the overlay's default, never overridden) behaves
 * the same way.
 */
function wrapLines(
	ctx: Canvas2DContext,
	text: string,
	maxWidth: number,
): string[] {
	const words = text.split(/\s+/).filter((word) => word.length > 0);
	if (words.length === 0) {
		return [];
	}

	const lines: string[] = [];
	let currentLine = words[0] as string;
	for (let i = 1; i < words.length; i++) {
		const word = words[i] as string;
		const candidate = `${currentLine} ${word}`;
		if (ctx.measureText(candidate).width <= maxWidth) {
			currentLine = candidate;
		} else {
			lines.push(currentLine);
			currentLine = word;
		}
	}
	lines.push(currentLine);
	return lines;
}

/**
 * Draws one frame's subtitle overlay onto `ctx`, converting the SAME
 * `SubtitleStyle` object `SubtitleOverlay` (remotion/composition.tsx) reads
 * into canvas drawing calls. This is the export-side twin of that CSS
 * overlay — see the module doc comment above for the scale derivation, and
 * the parity table in `export.ts`'s pipeline builder for the full CSS→canvas
 * mapping. Pure: no DOM/canvas allocation, only draws onto the context it's
 * given — safe to call every encoded frame against a single reused canvas.
 */
export function drawSubtitle(
	ctx: Canvas2DContext,
	params: DrawSubtitleParams,
): void {
	const { text, style, videoWidth, videoHeight } = params;
	if (!text) {
		return;
	}

	const scaleRatio = Math.sqrt((videoWidth * videoHeight) / REFERENCE_AREA_PX);
	const fontSizePx = (style.fontSize ?? DEFAULT_FONT_SIZE_PX) * scaleRatio;
	const fontWeight =
		style.weight === "bold" ? 700 : style.weight === "medium" ? 600 : 400;
	const rawFontFamily = style.font ?? DEFAULT_FONT_FAMILY;
	const fontFamily = /\s/.test(rawFontFamily)
		? `"${rawFontFamily}"`
		: rawFontFamily;
	const textColor = style.color ?? DEFAULT_TEXT_COLOR;
	const outlineColor = style.outlineColor ?? DEFAULT_OUTLINE_COLOR;
	const outlineWidthPx = OUTLINE_WIDTH_REFERENCE_PX * scaleRatio;
	const hasBackground = Boolean(style.backgroundColor);
	const isTop = style.position === "top";

	// `padding: "5% 6%"` on the overlay's AbsoluteFill: CSS resolves percentage
	// padding — including padding-top/padding-bottom — against the containing
	// block's WIDTH, never its height (CSS2.1 §8.4). Both the vertical safe
	// margin (5%) and the horizontal one (6%) are therefore fractions of
	// `videoWidth`, not `videoHeight`.
	const verticalSafeMargin = videoWidth * 0.05;
	const horizontalSafeMargin = videoWidth * 0.06;
	const contentBoxWidth = videoWidth - horizontalSafeMargin * 2;
	// `maxWidth: "90%"` on the text div, relative to that post-padding content box.
	const maxTextWidth = contentBoxWidth * 0.9;

	ctx.font = `${fontWeight} ${fontSizePx}px ${fontFamily}, sans-serif`;
	ctx.textAlign = "center";
	ctx.textBaseline = "alphabetic";

	const lines = wrapLines(ctx, text, maxTextWidth);
	if (lines.length === 0) {
		return;
	}

	const sampleMetrics = ctx.measureText("Mg");
	const ascent = sampleMetrics.fontBoundingBoxAscent ?? fontSizePx * 0.8;
	const descent = sampleMetrics.fontBoundingBoxDescent ?? fontSizePx * 0.2;
	const glyphBoxHeight = ascent + descent;
	const lineHeight = fontSizePx * LINE_HEIGHT_MULTIPLIER;

	const textBlockWidth = Math.max(
		...lines.map((line) => ctx.measureText(line).width),
	);
	const textBlockHeight = lines.length * lineHeight;

	// `padding: "0.35em 0.7em"` (em relative to this element's own font-size) —
	// only applied when a background is present, matching the overlay's ternary.
	const blockPaddingV = hasBackground ? fontSizePx * 0.35 : 0;
	const blockPaddingH = hasBackground ? fontSizePx * 0.7 : 0;
	const boxWidth = textBlockWidth + blockPaddingH * 2;
	const boxHeight = textBlockHeight + blockPaddingV * 2;

	// `alignItems: "center"` on the (column-direction, Remotion's AbsoluteFill
	// default) flex container centers the subtitle block horizontally within
	// the full padded box — symmetric left/right padding means that's simply
	// the frame's horizontal center regardless of the padding amount.
	const centerX = videoWidth / 2;
	// `justifyContent: position === "top" ? "flex-start" : "flex-end"` pins the
	// block to the top or bottom edge of the padded content box.
	const boxTop = isTop
		? verticalSafeMargin
		: videoHeight - verticalSafeMargin - boxHeight;

	if (hasBackground && style.backgroundColor) {
		traceRoundedRectPath(
			ctx,
			centerX - boxWidth / 2,
			boxTop,
			boxWidth,
			boxHeight,
			BACKGROUND_RADIUS_REFERENCE_PX * scaleRatio,
		);
		ctx.fillStyle = style.backgroundColor;
		ctx.fill();
	}

	// `paint-order: "stroke fill"` — stroke painted first (underneath), fill
	// painted second (on top), the classic canvas outline-text technique.
	ctx.lineWidth = outlineWidthPx;
	ctx.strokeStyle = outlineColor;
	ctx.lineJoin = "round";
	ctx.fillStyle = textColor;

	const firstLineTop = boxTop + blockPaddingV;
	lines.forEach((line, index) => {
		const lineTop = firstLineTop + index * lineHeight;
		const baselineY = lineTop + (lineHeight - glyphBoxHeight) / 2 + ascent;
		if (outlineWidthPx > 0) {
			ctx.strokeText(line, centerX, baselineY);
		}
		ctx.fillText(line, centerX, baselineY);
	});
}
