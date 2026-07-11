"use client";

/**
 * Root-layout error boundary (Next.js `global-error.tsx`): only fires when
 * the ROOT layout itself throws (fonts, `Providers`, etc.) — at that point
 * the root layout never rendered, so this file must supply its OWN
 * `<html>`/`<body>` and can't rely on globals.css/Tailwind utilities the
 * layout would normally provide (see docs/file-conventions/error.mdx: "must
 * define its own html and body tags"). Kept deliberately minimal and
 * self-styled (inline styles only) rather than trying to reproduce the full
 * design system in a boundary that may run without it.
 */
export default function GlobalError({
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	return (
		<html lang="en">
			<body
				style={{
					alignItems: "center",
					background: "#0a0a0a",
					color: "#fafafa",
					display: "flex",
					fontFamily:
						"-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
					justifyContent: "center",
					margin: 0,
					minHeight: "100svh",
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: "1rem",
						maxWidth: "24rem",
						padding: "2rem",
						textAlign: "center",
					}}
				>
					<span
						style={{
							fontSize: "0.875rem",
							fontWeight: 600,
							letterSpacing: "-0.01em",
							opacity: 0.6,
						}}
					>
						Zenkai
					</span>
					<h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>
						Something went wrong
					</h1>
					<p style={{ color: "#a1a1aa", fontSize: "0.875rem", margin: 0 }}>
						The app hit an unexpected error and couldn't load. Try again in a
						moment.
					</p>
					<button
						type="button"
						onClick={() => reset()}
						style={{
							background: "#fafafa",
							border: "none",
							borderRadius: "0.5rem",
							color: "#0a0a0a",
							cursor: "pointer",
							fontSize: "0.875rem",
							fontWeight: 500,
							margin: "0 auto",
							padding: "0.5rem 1rem",
						}}
					>
						Try again
					</button>
				</div>
			</body>
		</html>
	);
}
