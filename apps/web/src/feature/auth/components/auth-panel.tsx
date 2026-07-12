"use client";

import Image from "next/image";

import { DotPattern } from "@/components/ui/dot-pattern";
import { cn } from "@/libs/utils";

type ShowcaseClip = {
	key: string;
	/** Only the four product templates have a card still under the video. */
	hasStill: boolean;
	/** Tile shape — mixed aspects give the wall its bento rhythm. */
	aspect: string;
};

// Staggered two-column wall (Knock-style testimonial layout, bento boxes):
// each column is taller than the viewport and offset in opposite directions,
// so tiles crop against the top AND bottom edges — the content clearly
// continues beyond the box, with no scroll anywhere. Aspects are mixed
// (wide / portrait / square) so the two columns never align — that offset
// rhythm is the distribution. Footage only — no captions, no icons (user
// call). hockey/volleyball are showcase-only clips, not product templates.
const COLUMN_A: ShowcaseClip[] = [
	{ key: "soccer", hasStill: true, aspect: "aspect-video" },
	{ key: "tennis", hasStill: true, aspect: "aspect-[4/5]" },
	{ key: "hockey", hasStill: false, aspect: "aspect-square" },
	{ key: "track", hasStill: false, aspect: "aspect-video" },
];

const COLUMN_B: ShowcaseClip[] = [
	{ key: "basketball", hasStill: true, aspect: "aspect-[4/5]" },
	{ key: "volleyball", hasStill: false, aspect: "aspect-video" },
	{ key: "baseball", hasStill: true, aspect: "aspect-square" },
	{ key: "boxing", hasStill: false, aspect: "aspect-[4/5]" },
];

function ShowcaseTile({ clip }: { clip: ShowcaseClip }) {
	return (
		<div
			// The drop shadow lifts the wall off the bloom — without it the
			// tiles sit optically flat on the background light.
			className={cn(
				"relative overflow-hidden rounded-2xl bg-card/50 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.65)]",
				clip.aspect,
			)}
		>
			{/* Still underneath; the clip paints over it once it loads — a
			    missing mp4 degrades to the artwork (or the card tone for the
			    showcase-only sports) by construction. */}
			{clip.hasStill ? (
				<Image
					src={`/templates/${clip.key}-v2.png`}
					alt=""
					fill
					sizes="416px"
					className="object-cover"
				/>
			) : null}
			<video
				className="absolute inset-0 h-full w-full object-cover"
				src={`/templates/${clip.key}.mp4`}
				autoPlay
				muted
				loop
				playsInline
				aria-hidden
				// With 16 muted videos starting at once, the occasional copy
				// loses the autoplay race and mounts paused — nudge it once its
				// data is in (a no-op when autoplay already won).
				onLoadedData={(event) => {
					event.currentTarget.play().catch(() => {});
				}}
			/>
			{/* Ice layer (magicui bento signature): the inset light sheen sits
			    in its own overlay because an inset box-shadow on the tile root
			    would paint UNDER child content — the video always stays beneath
			    the frost. */}
			<div
				aria-hidden
				className="absolute inset-0 rounded-2xl [box-shadow:0_-20px_80px_-20px_rgba(255,255,255,0.14)_inset]"
			/>
			{/* Glass frame ABOVE the footage (user call: premium reads as the
			    border sitting on top, the video as the tile's background) —
			    on the root it would paint under the absolute video layer. */}
			<div aria-hidden className="glass-edge absolute inset-0 rounded-2xl" />
		</div>
	);
}

function ShowcaseColumn({
	clips,
	reverse = false,
	durationSeconds,
}: {
	clips: ShowcaseClip[];
	reverse?: boolean;
	durationSeconds: number;
}) {
	// Two identical copies, each carrying its own trailing gap (pb-6, no gap
	// between copies) — translateY(-50%) then lands EXACTLY on the second
	// copy's start, so the loop never jumps. Different speeds + directions
	// per column keep the wall organic instead of mechanical.
	const copy = (suffix: string) => (
		<div key={suffix} className="flex flex-col gap-6 pb-6">
			{clips.map((clip) => (
				<ShowcaseTile key={`${clip.key}-${suffix}`} clip={clip} />
			))}
		</div>
	);

	return (
		<div className="w-full max-w-[21rem] shrink-0">
			<div
				className="motion-reduce:[animation:none]"
				style={{
					animation: `marquee-y ${durationSeconds}s linear infinite${
						reverse ? " reverse" : ""
					}`,
				}}
			>
				{copy("a")}
				{copy("b")}
			</div>
		</div>
	);
}

/**
 * Right-side panel of the split-screen auth routes — a pure visual showcase,
 * no headline (user call): six template clips in a staggered two-column
 * bento wall. Each column is taller than the viewport and offset in
 * opposite directions, so tiles crop HARD against the top and bottom edges
 * (no top gradient — user call) and the wall reads as continuing beyond the
 * box, without any scroll. A subtle bottom fade melts the lower crop into
 * the panel tone; a glowing magicui DotPattern breathes behind everything.
 * Forces the `dark` class so the showcase reads identically whatever the
 * site theme resolves to. Hidden below `md`, where the form column takes
 * the full width.
 */
export function AuthPanel() {
	return (
		// h-screen is load-bearing: without a definite height the aside grows
		// to fit the overflowing columns BEFORE overflow-hidden clips it, and
		// the whole login page gains a scrollbar.
		<aside className="dark relative hidden h-screen overflow-hidden bg-[#0d0d0d] md:block">
			{/* Aurora bloom — the beam's colorful palette (border-beam's exact
			    hues: indigo/rose/cyan/amber/green) desaturated to ambient light.
			    Huge soft radials at 5-14% opacity give the void temperature and
			    tie the panel to the CTA's color story. Static by design. */}
			<div
				aria-hidden
				className="absolute inset-0 [background:radial-gradient(48%_42%_at_15%_10%,rgb(100_70_255/0.20),transparent_70%),radial-gradient(52%_46%_at_90%_20%,rgb(255_50_100/0.15),transparent_70%),radial-gradient(56%_50%_at_78%_85%,rgb(40_180_220/0.15),transparent_70%),radial-gradient(46%_40%_at_20%_80%,rgb(255_160_30/0.11),transparent_70%),radial-gradient(40%_34%_at_52%_45%,rgb(50_200_80/0.07),transparent_70%)]"
			/>

			{/* Dots ride ON TOP of the bloom — texture over light. Fine and
			    dense (small radius, tight spacing) reads premium; big dots read
			    wallpaper (user call). */}
			<DotPattern
				glow
				width={20}
				height={20}
				cr={1}
				className="text-muted-foreground/50 [mask-image:radial-gradient(95%_90%_at_50%_50%,white,transparent)]"
			/>

			<div className="relative flex h-full items-start justify-center gap-6 px-8">
				<ShowcaseColumn clips={COLUMN_A} durationSeconds={52} />
				<ShowcaseColumn clips={COLUMN_B} durationSeconds={64} reverse />
			</div>

			{/* Seam melt: the wall's left edge dissolves toward the form column
			    instead of kissing the split line. */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-[linear-gradient(to_right,var(--background),transparent)]"
			/>

			{/* Film grain over everything — the analog texture that keeps the
			    panel from reading flat-digital; barely-there by design. */}
			<div
				aria-hidden
				className="film-grain pointer-events-none absolute inset-0 z-10 opacity-[0.05]"
			/>

			{/* Bottom fade only (the top crops hard — user call): the lower cut
			    melts into the panel tone instead of ending on a hard pixel row. */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-[linear-gradient(to_bottom,transparent,#0d0d0d_88%)]"
			/>
		</aside>
	);
}
