"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { wrap } from "popmotion";
import { useEffect, useMemo, useRef, useState } from "react";

export interface ResponsiveSize {
	"2xl"?: number | string;
	base?: number | string;
	lg?: number | string;
	md?: number | string;
	sm?: number | string;
	xl?: number | string;
}

const breakpoints = {
	sm: 640,
	md: 768,
	lg: 1024,
	xl: 1280,
	"2xl": 1536,
} as const;

const DEFAULT_CARD_WIDTH = 240;
const DEFAULT_ASPECT_RATIO = 1.5625; // 5:8 ratio (500/320)

// Base sizes for responsive scaling (based on DEFAULT_CARD_WIDTH = 240)
const BASE_BADGE_FONT_SIZE = 12;
const BASE_BADGE_PADDING_X = 12;
const BASE_BADGE_PADDING_Y = 3;
const BASE_BADGE_ICON_SIZE = 14;
const BASE_TITLE_FONT_SIZE = 18;
const BASE_SUBTITLE_FONT_SIZE = 12;
const BASE_LOCATION_FONT_SIZE = 12;
const BASE_AVATAR_SIZE = 24;
const BASE_CONTENT_PADDING = 24;
const BASE_BADGE_TOP = 16;
const BASE_BADGE_LEFT = 16;
const BASE_BADGE_GAP = 8;
const BASE_AVATAR_GAP = 8;
const BASE_AVATAR_MARGIN_BOTTOM = 8;
const BASE_TITLE_MARGIN_BOTTOM = 4;
const BASE_LINE_HEIGHT = 1.4;
const BADGE_PADDING_Y_SCALE_FACTOR = 0.7; // Reduce vertical padding scaling for more compact badges

// Minimum sizes to ensure readability
const MIN_BADGE_FONT_SIZE = 10;
const MIN_BADGE_PADDING_X = 8;
const MIN_BADGE_PADDING_Y = 1;
const MIN_BADGE_ICON_SIZE = 12;
const MIN_TITLE_FONT_SIZE = 14;
const MIN_SUBTITLE_FONT_SIZE = 10;
const MIN_LOCATION_FONT_SIZE = 10;
const MIN_AVATAR_SIZE = 20;
const MIN_CONTENT_PADDING = 12;
const MIN_BADGE_TOP = 8;
const MIN_BADGE_LEFT = 8;
const MIN_BADGE_GAP = 4;
const MIN_AVATAR_GAP = 4;
const MIN_AVATAR_MARGIN_BOTTOM = 4;
const MIN_TITLE_MARGIN_BOTTOM = 2;

function formatSize(size: number | string): string {
	return typeof size === "number" ? `${size}px` : size;
}

function getInitialSize(
	size: number | string | ResponsiveSize | undefined,
	defaultValue: number | string,
): string {
	if (!size) {
		return formatSize(defaultValue);
	}
	if (typeof size === "number" || typeof size === "string") {
		return formatSize(size);
	}
	// Responsive object - start with base or first available value
	if (size.base !== undefined) {
		return formatSize(size.base);
	}
	return formatSize(defaultValue);
}

function getSizeForBreakpoint(
	size: ResponsiveSize,
	width: number,
): number | string | undefined {
	if (width >= breakpoints["2xl"]) {
		return size["2xl"] ?? size.xl ?? size.lg ?? size.md ?? size.sm ?? size.base;
	}
	if (width >= breakpoints.xl) {
		return size.xl ?? size.lg ?? size.md ?? size.sm ?? size.base;
	}
	if (width >= breakpoints.lg) {
		return size.lg ?? size.md ?? size.sm ?? size.base;
	}
	if (width >= breakpoints.md) {
		return size.md ?? size.sm ?? size.base;
	}
	if (width >= breakpoints.sm) {
		return size.sm ?? size.base;
	}
	return size.base;
}

function useResponsiveSize(
	size: number | string | ResponsiveSize | undefined,
	defaultValue: number | string,
): string {
	const [currentSize, setCurrentSize] = useState<string>(() =>
		getInitialSize(size, defaultValue),
	);

	useEffect(() => {
		if (!size || typeof size === "number" || typeof size === "string") {
			return;
		}

		const updateSize = () => {
			const width = window.innerWidth;
			const selectedSize = getSizeForBreakpoint(size, width);

			if (selectedSize !== undefined) {
				const newSize = formatSize(selectedSize);
				setCurrentSize(newSize);
			}
		};

		updateSize();
		window.addEventListener("resize", updateSize);
		return () => window.removeEventListener("resize", updateSize);
	}, [size]);

	return currentSize;
}

function parseSize(size: string): number {
	const num = Number.parseFloat(size);
	return Number.isNaN(num) ? 0 : num;
}

function calculateHeightFromWidth(width: string, aspectRatio: number): string {
	const widthNum = parseSize(width);
	if (widthNum === 0) {
		return width;
	}
	const heightNum = widthNum * aspectRatio;
	return `${heightNum}px`;
}

export interface Participant {
	avatar: string;
}

export interface Event {
	backgroundClassName?: string;
	badge?: string;
	id: number;
	image?: string;
	location?: string;
	participants?: Participant[];
	subtitle?: string;
	title?: string;
}

export interface AppleInvitesProps {
	activeIndex?: number;
	aspectRatio?: number;
	cardClassName?: string;
	cardHeight?: number | string | ResponsiveSize;
	cardWidth?: number | string | ResponsiveSize;
	className?: string;
	events: Event[];
	interval?: number;
	onChange?: (index: number) => void;
}

export default function AppleInvites({
	events,
	interval = 3000,
	className = "",
	cardClassName = "",
	activeIndex: controlledIndex,
	onChange,
	cardWidth = DEFAULT_CARD_WIDTH,
	cardHeight,
	aspectRatio = DEFAULT_ASPECT_RATIO,
}: AppleInvitesProps) {
	const shouldReduceMotion = useReducedMotion();
	const [internalPage, setInternalPage] = useState(0);
	const [direction, setDirection] = useState(0);
	const responsiveWidth = useResponsiveSize(cardWidth, DEFAULT_CARD_WIDTH);

	const variants = useMemo(
		() => ({
			center: {
				x: "-50%",
				rotate: 0,
				scale: 1,
				opacity: 1,
				zIndex: 3,
				transition: shouldReduceMotion
					? { duration: 0 }
					: {
							type: "spring" as const,
							stiffness: 300,
							damping: 30,
							duration: 0.25,
						},
			},
			left: {
				x: "-150%",
				rotate: -12,
				scale: 0.9,
				opacity: 0.8,
				zIndex: 2,
				transition: shouldReduceMotion
					? { duration: 0 }
					: {
							type: "spring" as const,
							stiffness: 300,
							damping: 30,
							duration: 0.25,
						},
			},
			right: {
				x: "50%",
				rotate: 12,
				scale: 0.9,
				opacity: 0.8,
				zIndex: 2,
				transition: shouldReduceMotion
					? { duration: 0 }
					: {
							type: "spring" as const,
							stiffness: 300,
							damping: 30,
							duration: 0.25,
						},
			},
			hidden: {
				opacity: 0,
				zIndex: 1,
				transition: shouldReduceMotion ? { duration: 0 } : { duration: 0.3 },
			},
		}),
		[shouldReduceMotion],
	);
	const explicitHeight = useResponsiveSize(
		cardHeight,
		calculateHeightFromWidth(responsiveWidth, aspectRatio),
	);
	const [calculatedHeight, setCalculatedHeight] = useState<string>(() =>
		calculateHeightFromWidth(responsiveWidth, aspectRatio),
	);

	// Update calculated height when width changes (if using aspect ratio)
	useEffect(() => {
		if (cardHeight === undefined) {
			setCalculatedHeight(
				calculateHeightFromWidth(responsiveWidth, aspectRatio),
			);
		}
	}, [responsiveWidth, aspectRatio, cardHeight]);

	const responsiveHeight =
		cardHeight === undefined ? calculatedHeight : explicitHeight;

	// Calculate responsive sizes based on card width
	const cardWidthNum = parseSize(responsiveWidth);
	const scaleFactor = cardWidthNum / DEFAULT_CARD_WIDTH;

	// Responsive sizes for internal content
	const _badgeFontSize = Math.max(
		MIN_BADGE_FONT_SIZE,
		Math.round(BASE_BADGE_FONT_SIZE * scaleFactor),
	);
	const _badgePaddingX = Math.max(
		MIN_BADGE_PADDING_X,
		Math.round(BASE_BADGE_PADDING_X * scaleFactor),
	);
	// Use a more aggressive scaling for vertical padding to keep it compact
	// Scale padding Y less aggressively to keep badges more compact
	const _badgePaddingY = Math.max(
		MIN_BADGE_PADDING_Y,
		Math.round(
			BASE_BADGE_PADDING_Y * scaleFactor * BADGE_PADDING_Y_SCALE_FACTOR,
		),
	);
	const _badgeIconSize = Math.max(
		MIN_BADGE_ICON_SIZE,
		Math.round(BASE_BADGE_ICON_SIZE * scaleFactor),
	);
	const _titleFontSize = Math.max(
		MIN_TITLE_FONT_SIZE,
		Math.round(BASE_TITLE_FONT_SIZE * scaleFactor),
	);
	const subtitleFontSize = Math.max(
		MIN_SUBTITLE_FONT_SIZE,
		Math.round(BASE_SUBTITLE_FONT_SIZE * scaleFactor),
	);
	const _locationFontSize = Math.max(
		MIN_LOCATION_FONT_SIZE,
		Math.round(BASE_LOCATION_FONT_SIZE * scaleFactor),
	);
	const _avatarSize = Math.max(
		MIN_AVATAR_SIZE,
		Math.round(BASE_AVATAR_SIZE * scaleFactor),
	);
	const contentPadding = Math.max(
		MIN_CONTENT_PADDING,
		Math.round(BASE_CONTENT_PADDING * scaleFactor),
	);
	const _badgeTop = Math.max(
		MIN_BADGE_TOP,
		Math.round(BASE_BADGE_TOP * scaleFactor),
	);
	const _badgeLeft = Math.max(
		MIN_BADGE_LEFT,
		Math.round(BASE_BADGE_LEFT * scaleFactor),
	);
	const _badgeGap = Math.max(
		MIN_BADGE_GAP,
		Math.round(BASE_BADGE_GAP * scaleFactor),
	);
	const _avatarGap = Math.max(
		MIN_AVATAR_GAP,
		Math.round(BASE_AVATAR_GAP * scaleFactor),
	);
	const _avatarMarginBottom = Math.max(
		MIN_AVATAR_MARGIN_BOTTOM,
		Math.round(BASE_AVATAR_MARGIN_BOTTOM * scaleFactor),
	);
	const titleMarginBottom = Math.max(
		MIN_TITLE_MARGIN_BOTTOM,
		Math.round(BASE_TITLE_MARGIN_BOTTOM * scaleFactor),
	);

	const page = controlledIndex === undefined ? internalPage : controlledIndex;
	const setPage = (val: number, dir: number) => {
		if (onChange) {
			onChange(val);
		} else {
			setInternalPage(val);
			setDirection(dir);
		}
	};

	const activeIndex = wrap(0, events.length, page);
	const setPageRef = useRef(setPage);

	useEffect(() => {
		setPageRef.current = setPage;
	});

	useEffect(() => {
		const timer = setInterval(() => {
			setPageRef.current(page + 1, 1);
		}, interval);
		return () => clearInterval(timer);
	}, [page, interval]);

	// With fewer than 3 events, the -1/0/+1 fan wraps back onto the same
	// event(s) it's already showing — e.g. a single event would render the
	// *same* card three times (duplicate React keys, three tilted copies of
	// one project). Collapse to just the center slot in that case; 3+ events
	// keep the original fan behavior untouched.
	const visibleEvents =
		events.length <= 1
			? [events[0]]
			: [-1, 0, 1].map(
					(offset) => events[wrap(0, events.length, activeIndex + offset)],
				);

	const getVariant = (index: number) => {
		if (index === 1) {
			return "center";
		}
		if (index === 0) {
			return "left";
		}
		return "right";
	};

	const renderBackground = (event: Event) => {
		if (event.backgroundClassName) {
			return <div className={`h-full w-full ${event.backgroundClassName}`} />;
		}
		if (event.image) {
			return (
				<img
					alt={event.title || ""}
					className="h-full w-full object-cover"
					height={400}
					src={event.image}
					width={400}
				/>
			);
		}
		return null;
	};

	return (
		<div
			className={`relative flex h-full w-full items-center justify-center ${className}`}
		>
			<AnimatePresence custom={direction} initial={false}>
				{visibleEvents.map((event, index) => (
					<motion.div
						animate={events.length <= 1 ? "center" : getVariant(index)}
						className={`absolute top-1/2 left-1/2 origin-center -translate-y-1/2 ${cardClassName}`}
						custom={direction}
						exit="hidden"
						initial="hidden"
						key={events.length <= 1 ? event.id : `${event.id}-${index}`}
						style={{
							width: responsiveWidth,
							height: responsiveHeight,
						}}
						variants={variants}
					>
						<div className="relative h-full w-full overflow-hidden rounded-3xl bg-primary">
							{renderBackground(event)}
							{/* Content — hero TemplateCard footer style per design direction:
							    left-aligned mini title + truncated prompt line. No badge,
							    no icon, no avatars, no big centered title. */}
							<div
								className="absolute bottom-0 z-3 w-full rounded-b-3xl text-left text-white"
								style={{ padding: `${contentPadding}px` }}
							>
								{event.title && (
									<p
										className="wrap-break-word font-semibold"
										style={{
											fontSize: `${subtitleFontSize + 3}px`,
											lineHeight: BASE_LINE_HEIGHT,
											marginBottom: `${titleMarginBottom}px`,
										}}
									>
										{event.title}
									</p>
								)}
								{event.subtitle && (
									<p
										className="truncate opacity-80"
										style={{
											fontSize: `${subtitleFontSize}px`,
											lineHeight: BASE_LINE_HEIGHT,
										}}
									>
										{event.subtitle}
									</p>
								)}
							</div>
							<div className="fixed inset-x-0 bottom-0 isolate z-2 h-1/2">
								<div className="gradient-mask-t-0 absolute inset-0 overflow-hidden rounded-3xl backdrop-blur-[1px]" />
								<div className="gradient-mask-t-0 absolute inset-0 overflow-hidden rounded-3xl backdrop-blur-[2px]" />
								<div className="gradient-mask-t-0 absolute inset-0 overflow-hidden rounded-3xl backdrop-blur-[3px]" />
								<div className="gradient-mask-t-0 absolute inset-0 overflow-hidden rounded-3xl backdrop-blur-[6px]" />
								<div className="gradient-mask-t-0 absolute inset-0 overflow-hidden rounded-3xl backdrop-blur-[12px]" />
							</div>
						</div>
					</motion.div>
				))}
			</AnimatePresence>
		</div>
	);
}
