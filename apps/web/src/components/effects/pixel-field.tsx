"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/libs/utils";

export type PixelFieldProps = {
	className?: string;
	/** String seed to generate a unique deterministic band layout */
	seed?: string;
	/** Enable animation (respects prefers-reduced-motion) */
	animated?: boolean;
};

/**
 * TRAE.ai-style animated pixel field — a sparse constellation of tiny squares
 * drifting in loose diagonal bands, in the AgentAvatar pixel-art register.
 *
 * PERFORMANCE CONTRACT (this component crashed the renderer in its first
 * incarnation — every rule below exists to keep that from ever recurring):
 * 1. ALL field math (value noise, banding, masking) runs ONCE per resize, in
 *    `buildCells`. The animation loop touches no noise, no `**`, no sqrt.
 * 2. The lit-cell count is hard-capped (`MAX_LIT_CELLS`) — a 5K monitor gets
 *    the same draw budget as a laptop; density thins instead of exploding.
 * 3. The loop ticks at `TICK_FPS` (12), not the display refresh rate — pixel
 *    flicker is a low-frequency effect; 12 updates/sec reads identically to
 *    60 and costs 1/5 as much.
 * 4. Canvas buffer DPR is clamped to 2 — retina-sharp, never 3x/4x buffers.
 * 5. Per tick the work is: ~`MAX_LIT_CELLS` alpha lerps + fillRects from a
 *    bounded fillStyle cache. No allocations, no string building in the loop
 *    beyond the first few dozen cache misses.
 * Plus the standard hygiene: static frame under prefers-reduced-motion,
 * pause while the tab is hidden, debounced resize, full cleanup.
 */

/** Grid — square cells on a fixed pitch, in CSS px. */
const SQUARE_SIZE = 3;
const GRID_GAP = 6;
const PITCH = SQUARE_SIZE + GRID_GAP;

/** Hard ceiling on drawn cells, independent of viewport size (rule 2). */
const MAX_LIT_CELLS = 900;
/** Fraction of grid cells lit on small viewports (the cap wins on large). */
const LIT_FRACTION = 0.09;

/** Animation cadence (rule 3). */
const TICK_FPS = 12;
const TICK_MS = 1000 / TICK_FPS;

/**
 * Density field — value noise sampled along a rotated axis so lit cells form
 * loose diagonal bands (TRAE's signature) instead of a uniform scatter.
 * Computed once per resize only.
 */
const ROTATION_DEG = -30;
const BAND_FREQ = 1 / 800;
const BAND_OCTAVES = 2;
const BAND_POWER = 1.8;
const FINE_FREQ = 1 / 60;
const FINE_POWER = 1.5;
const FINE_SEED_OFFSET = 7919;

/** Color — token-driven; a small share of lit pixels carry the green accent. */
const ACCENT_FRACTION = 0.12;
const BASE_ALPHA_RANGE: readonly [number, number] = [0.1, 0.3];
const ACCENT_ALPHA_RANGE: readonly [number, number] = [0.3, 0.6];
const FALLBACK_BASE_HEX = "#9a9a9a";
const FALLBACK_ACCENT_HEX = "#4ade80";

/** Flicker — mean seconds between retargets per cell, eased per tick. */
const FLICKER_RATE_PER_SEC = 0.05;
const FLICKER_EASE_MS = 700;
const MAX_FRAME_DELTA_MS = 250;

/** Center readability mask — the content zone stays clean. */
const MASK_CENTER_X_RATIO = 0.5;
const MASK_CENTER_Y_RATIO = 0.45;
const MASK_RADIUS_RATIO = 0.45;
const MASK_MIN_FACTOR = 0.2;

const RESIZE_DEBOUNCE_MS = 200;
const MAX_DPR = 2;

/** Deterministic string hash (same recipe as AgentAvatar). */
const hashSeed = (str: string): number => {
	let hash = 0;
	for (const char of str) {
		hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
	}
	return Math.abs(hash);
};

/** Seeded PRNG, mulberry32 (same recipe as AgentAvatar). */
const createRng = (seed: number) => {
	let state = seed;
	return () => {
		state = (state + 0x6d_2b_79_f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
};

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

const hash2D = (ix: number, iy: number, seed: number): number => {
	let h = ix * 374_761_393 + iy * 668_265_263 + seed * 2_147_483_647;
	h = Math.imul(h ^ (h >>> 13), 1_274_126_177);
	h ^= h >>> 16;
	return ((h >>> 0) % 1_000_000) / 1_000_000;
};

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

const valueNoise2D = (x: number, y: number, seed: number): number => {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const sx = fade(x - x0);
	const sy = fade(y - y0);
	const n00 = hash2D(x0, y0, seed);
	const n10 = hash2D(x0 + 1, y0, seed);
	const n01 = hash2D(x0, y0 + 1, seed);
	const n11 = hash2D(x0 + 1, y0 + 1, seed);
	return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
};

const fbm1D = (x: number, seed: number, octaves: number): number => {
	let sum = 0;
	let amplitude = 0.5;
	let frequency = 1;
	let max = 0;
	for (let i = 0; i < octaves; i++) {
		sum += valueNoise2D(x * frequency, 0, seed + i * 101) * amplitude;
		max += amplitude;
		amplitude *= 0.5;
		frequency *= 2;
	}
	return sum / max;
};

const resolveColor = (varName: string, fallbackHex: string): string => {
	const value = getComputedStyle(document.documentElement)
		.getPropertyValue(varName)
		.trim();
	return value.length > 0 ? value : fallbackHex;
};

const hexToRgb = (hex: string): [number, number, number] => {
	const normalized = hex.replace("#", "");
	return [
		Number.parseInt(normalized.slice(0, 2), 16),
		Number.parseInt(normalized.slice(2, 4), 16),
		Number.parseInt(normalized.slice(4, 6), 16),
	];
};

/** Injects an alpha channel into a resolved CSS color (hex, oklch, rgb…). */
const withAlpha = (color: string, alpha: number): string => {
	if (color.startsWith("#")) {
		const [r, g, b] = hexToRgb(color);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}
	return color.includes("/")
		? color.replace(/\/[^)]+\)/, `/ ${alpha})`)
		: color.replace(/\)\s*$/, ` / ${alpha})`);
};

type LitCell = {
	x: number;
	y: number;
	isAccent: boolean;
	/** Static per cell — mask and band brightness baked at build time (rule 1). */
	brightness: number;
	alphaFrom: number;
	alphaTo: number;
	easeStartMs: number;
};

export function PixelField({
	className,
	seed = "dashboard",
	animated = true,
}: PixelFieldProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) {
			return;
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}

		const seedHash = hashSeed(seed);
		const thetaRad = (ROTATION_DEG * Math.PI) / 180;
		const cosT = Math.cos(thetaRad);
		const sinT = Math.sin(thetaRad);

		const baseColor = resolveColor("--muted-foreground", FALLBACK_BASE_HEX);
		const accentColor = resolveColor("--chart-5", FALLBACK_ACCENT_HEX);
		// Alpha quantized to 1/50 steps -> the cache tops out around a hundred
		// entries; after warmup the loop never builds a string again (rule 5).
		const styleCache = new Map<string, string>();
		const getFillStyle = (isAccent: boolean, alpha: number): string => {
			const rounded = Math.round(clamp(alpha, 0, 1) * 50) / 50;
			const key = `${isAccent ? "a" : "b"}:${rounded}`;
			let style = styleCache.get(key);
			if (!style) {
				style = withAlpha(isAccent ? accentColor : baseColor, rounded);
				styleCache.set(key, style);
			}
			return style;
		};

		let width = 0;
		let height = 0;
		let litCells: LitCell[] = [];

		/** ALL field math lives here — runs once per resize, never per frame. */
		const buildCells = () => {
			const rect = canvas.getBoundingClientRect();
			width = rect.width;
			height = rect.height;
			if (width === 0 || height === 0) {
				return;
			}

			const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
			canvas.width = Math.max(1, Math.round(width * dpr));
			canvas.height = Math.max(1, Math.round(height * dpr));
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

			const cols = Math.ceil(width / PITCH);
			const rows = Math.ceil(height / PITCH);
			const offset = (PITCH - SQUARE_SIZE) / 2;

			const candidates: {
				x: number;
				y: number;
				band: number;
				density: number;
			}[] = [];
			for (let row = 0; row < rows; row++) {
				for (let col = 0; col < cols; col++) {
					const x = col * PITCH + offset;
					const y = row * PITCH + offset;
					const u = x * cosT - y * sinT;
					const band =
						fbm1D(u * BAND_FREQ, seedHash, BAND_OCTAVES) ** BAND_POWER;
					const fine =
						valueNoise2D(
							x * FINE_FREQ,
							y * FINE_FREQ,
							seedHash + FINE_SEED_OFFSET,
						) ** FINE_POWER;
					candidates.push({ x, y, band, density: band * fine });
				}
			}

			candidates.sort((a, b) => b.density - a.density);
			const litCount = Math.min(
				Math.round(candidates.length * LIT_FRACTION),
				MAX_LIT_CELLS,
			);
			const selected = candidates.slice(0, litCount);

			const rng = createRng(seedHash + 1);
			const maskCenterX = width * MASK_CENTER_X_RATIO;
			const maskCenterY = height * MASK_CENTER_Y_RATIO;
			const maskRadius = Math.min(width, height) * MASK_RADIUS_RATIO;

			litCells = selected.map(({ x, y, band }) => {
				const isAccent = rng() < ACCENT_FRACTION;
				const [min, max] = isAccent ? ACCENT_ALPHA_RANGE : BASE_ALPHA_RANGE;
				const initialAlpha = lerp(min, max, rng());
				const dist = Math.hypot(x - maskCenterX, y - maskCenterY);
				const maskT = clamp(dist / maskRadius, 0, 1);
				const maskFactor = lerp(MASK_MIN_FACTOR, 1, smoothstep(maskT));

				return {
					x,
					y,
					isAccent,
					brightness: maskFactor * lerp(0.7, 1.3, band),
					alphaFrom: initialAlpha,
					alphaTo: initialAlpha,
					easeStartMs: 0,
				};
			});
		};

		/** One animation tick — bounded work only (rules 1, 5). */
		const renderTick = (nowMs: number, dtMs: number, animate: boolean) => {
			const flickerProbability = animate
				? 1 - Math.exp(-FLICKER_RATE_PER_SEC * (dtMs / 1000))
				: 0;

			ctx.clearRect(0, 0, width, height);

			for (const cell of litCells) {
				let currentAlpha: number;
				if (animate) {
					const easeT = clamp(
						(nowMs - cell.easeStartMs) / FLICKER_EASE_MS,
						0,
						1,
					);
					currentAlpha = lerp(
						cell.alphaFrom,
						cell.alphaTo,
						easeOutCubic(easeT),
					);
					if (Math.random() < flickerProbability) {
						const [min, max] = cell.isAccent
							? ACCENT_ALPHA_RANGE
							: BASE_ALPHA_RANGE;
						cell.alphaFrom = currentAlpha;
						cell.alphaTo = lerp(min, max, Math.random());
						cell.easeStartMs = nowMs;
					}
				} else {
					currentAlpha = cell.alphaFrom;
				}

				ctx.fillStyle = getFillStyle(
					cell.isAccent,
					currentAlpha * cell.brightness,
				);
				ctx.fillRect(cell.x, cell.y, SQUARE_SIZE, SQUARE_SIZE);
			}
		};

		const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
		let shouldAnimate = animated && !motionQuery.matches;
		let rafId = 0;
		let lastTickMs = 0;

		// rAF-driven but gated to TICK_FPS (rule 3): rAF keeps us aligned with
		// the compositor and auto-throttled in background tabs; the gate keeps
		// the paint cost at 12 ticks/sec.
		const loop = (time: number) => {
			rafId = requestAnimationFrame(loop);
			const dtMs = time - lastTickMs;
			if (dtMs < TICK_MS) {
				return;
			}
			lastTickMs = time;
			renderTick(time, Math.min(dtMs, MAX_FRAME_DELTA_MS), true);
		};

		const start = () => {
			cancelAnimationFrame(rafId);
			if (shouldAnimate) {
				lastTickMs = 0;
				rafId = requestAnimationFrame(loop);
			} else {
				renderTick(performance.now(), 0, false);
			}
		};

		buildCells();
		start();
		// Premium entrance: the field fades in once the first frame is drawn
		// (CSS transition on the element, no per-frame JS cost).
		canvas.style.opacity = "1";

		const handleMotionChange = () => {
			shouldAnimate = animated && !motionQuery.matches;
			start();
		};
		motionQuery.addEventListener("change", handleMotionChange);

		const handleVisibilityChange = () => {
			if (document.hidden) {
				cancelAnimationFrame(rafId);
			} else {
				start();
			}
		};
		document.addEventListener("visibilitychange", handleVisibilityChange);

		let resizeTimeout: ReturnType<typeof setTimeout> | undefined;
		const resizeObserver = new ResizeObserver(() => {
			clearTimeout(resizeTimeout);
			resizeTimeout = setTimeout(() => {
				buildCells();
				if (!shouldAnimate) {
					renderTick(performance.now(), 0, false);
				}
			}, RESIZE_DEBOUNCE_MS);
		});
		resizeObserver.observe(canvas);

		return () => {
			cancelAnimationFrame(rafId);
			clearTimeout(resizeTimeout);
			resizeObserver.disconnect();
			motionQuery.removeEventListener("change", handleMotionChange);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [seed, animated]);

	return (
		<canvas
			aria-hidden
			className={cn(
				"pointer-events-none block opacity-0 transition-opacity duration-700 ease-out",
				className,
			)}
			ref={canvasRef}
		/>
	);
}

export default PixelField;
