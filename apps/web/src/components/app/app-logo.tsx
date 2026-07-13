import { cn } from "@/libs/utils";

export type AppLogoProps = {
	/** Mark size in px. */
	size?: number;
	/** Renders the wordmark next to the mark. Set false for icon-only contexts (e.g. a collapsed sidebar rail). */
	wordmark?: boolean;
	className?: string;
};

/**
 * Shared app identity mark — the Zenkai badge (Untitled UI "Boltshift"
 * logomark, dark-mode variant, vendored to /logo.svg) plus wordmark, reused
 * across the sidebar header, the auth pages, and the Home hero so the brand
 * mark never gets re-derived ad hoc. "Zenkai" (全開) — full throttle — the
 * sports-anime register in one word.
 */
export function AppLogo({
	size = 28,
	wordmark = true,
	className,
}: AppLogoProps) {
	return (
		<span className={cn("flex min-w-0 items-center gap-2", className)}>
			{/* biome-ignore lint/performance/noImgElement: static local SVG badge — next/image refuses SVG without dangerouslyAllowSVG, and there's nothing to optimize. */}
			<img
				src="/logo.svg"
				alt="Zenkai"
				width={size}
				height={size}
				className="shrink-0 rounded-[25%]"
			/>
			{wordmark ? (
				<span className="truncate font-heading font-semibold text-sm tracking-tight">
					Zenkai
				</span>
			) : null}
		</span>
	);
}
