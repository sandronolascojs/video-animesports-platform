"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/libs/utils";

export type FlickeringGridProps = {
	/** Side length of each square, in CSS px. */
	squareSize?: number;
	/** Gap between squares, in CSS px. */
	gridGap?: number;
	/** Probability [0, 1] that a square's opacity is re-rolled on a given frame. */
	flickerChance?: number;
	/** Any valid CSS color — resolved to RGB once via an offscreen canvas. */
	color?: string;
	/** Upper bound for a square's random opacity. */
	maxOpacity?: number;
	className?: string;
};

type Rgb = { r: number; g: number; b: number };

const FALLBACK_RGB: Rgb = { r: 255, g: 255, b: 255 };

/**
 * Resolves any CSS color string to RGB via a 1x1 offscreen canvas — works
 * for hex, rgb()/rgba(), hsl(), and named colors alike, so callers don't
 * have to pre-normalize the `color` prop.
 */
function resolveRgb(color: string): Rgb {
	const canvas = document.createElement("canvas");
	canvas.width = 1;
	canvas.height = 1;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return FALLBACK_RGB;
	}
	ctx.fillStyle = color;
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
	return {
		r: r ?? FALLBACK_RGB.r,
		g: g ?? FALLBACK_RGB.g,
		b: b ?? FALLBACK_RGB.b,
	};
}

/**
 * Canvas-based "flickering squares" ambient effect (magicui-style, written
 * from scratch — no extra runtime dependency). Draws a grid of squares whose
 * opacity randomly re-rolls each frame at `flickerChance`, producing a
 * subtle static/noise texture. Tracks its parent's size via ResizeObserver
 * and renders at `devicePixelRatio` for crisp edges on HiDPI screens.
 *
 * Usage: render as an absolutely-positioned overlay inside a `relative`
 * parent, e.g. `<FlickeringGrid className="absolute inset-0 h-full w-full" />`.
 */
export function FlickeringGrid({
	squareSize = 4,
	gridGap = 6,
	flickerChance = 0.3,
	color = "rgb(255, 255, 255)",
	maxOpacity = 0.2,
	className,
}: FlickeringGridProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const container = containerRef.current;
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!container || !canvas || !ctx) {
			return;
		}

		const rgb = resolveRgb(color);
		let cols = 0;
		let rows = 0;
		let opacities = new Float32Array(0);
		let rafId = 0;

		function resize() {
			if (!container || !canvas) {
				return;
			}
			const { width, height } = container.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;

			canvas.width = Math.max(1, Math.floor(width * dpr));
			canvas.height = Math.max(1, Math.floor(height * dpr));
			canvas.style.width = `${width}px`;
			canvas.style.height = `${height}px`;
			ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);

			const cell = squareSize + gridGap;
			cols = Math.max(1, Math.ceil(width / cell));
			rows = Math.max(1, Math.ceil(height / cell));
			opacities = new Float32Array(cols * rows);
			for (let i = 0; i < opacities.length; i++) {
				opacities[i] = Math.random() * maxOpacity;
			}
		}

		function draw() {
			if (!container || !ctx) {
				return;
			}
			const { width, height } = container.getBoundingClientRect();
			ctx.clearRect(0, 0, width, height);

			const cell = squareSize + gridGap;
			for (let row = 0; row < rows; row++) {
				for (let col = 0; col < cols; col++) {
					const index = row * cols + col;
					if (Math.random() < flickerChance) {
						opacities[index] = Math.random() * maxOpacity;
					}
					const opacity = opacities[index] ?? 0;
					ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
					ctx.fillRect(col * cell, row * cell, squareSize, squareSize);
				}
			}

			rafId = requestAnimationFrame(draw);
		}

		resize();
		rafId = requestAnimationFrame(draw);

		const resizeObserver = new ResizeObserver(() => {
			resize();
		});
		resizeObserver.observe(container);

		return () => {
			cancelAnimationFrame(rafId);
			resizeObserver.disconnect();
		};
	}, [squareSize, gridGap, flickerChance, color, maxOpacity]);

	return (
		<div ref={containerRef} className={cn("pointer-events-none", className)}>
			<canvas ref={canvasRef} className="block h-full w-full" />
		</div>
	);
}
