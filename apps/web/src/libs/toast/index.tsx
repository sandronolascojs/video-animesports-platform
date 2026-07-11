"use client";

import {
	CheckCircle2Icon,
	InfoIcon,
	Loader2Icon,
	OctagonXIcon,
	TriangleAlertIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { SileoOptions } from "sileo";
import { Toaster as SileoToaster, sileo } from "sileo";

/**
 * The only module allowed to import from "sileo" — every call site in the app
 * goes through `toast.*` / `<Toaster />` below, never `sileo.*` directly, so
 * the icon set, theming, and position stay consistent and swapping toast
 * libraries again only touches this file. Replaces the previous sonner setup
 * (components/ui/sonner.tsx).
 *
 * Sileo renders the toast "pill" as an SVG `<rect fill>`, not a CSS
 * background. Theming lives entirely in the `<Toaster>` options below (no
 * custom [data-sileo-*] CSS): light mode keeps Sileo's defaults, dark mode
 * overrides the fill with the shadcn `--card` token and retints title/
 * description/button through Sileo's `styles` className hooks.
 */

const ICON_CLASS = "size-4";

const STATE_ICON = {
	success: <CheckCircle2Icon className={ICON_CLASS} />,
	error: <OctagonXIcon className={ICON_CLASS} />,
	warning: <TriangleAlertIcon className={ICON_CLASS} />,
	info: <InfoIcon className={ICON_CLASS} />,
	loading: <Loader2Icon className={`${ICON_CLASS} animate-spin`} />,
} as const;

type ToastState = "success" | "error" | "warning" | "info";

type ToastAction = {
	label: string;
	onClick: () => void;
};

type ToastOptions = {
	title: string;
	/** Required: every notification carries a main title AND a subtitle line. */
	description: ReactNode;
	action?: ToastAction;
	/** Milliseconds before auto-dismiss. Omit for sileo's default (6s). */
	duration?: number;
	/** Overrides the default per-severity badge icon (e.g. to echo the triggering button's lucide icon). */
	icon?: ReactNode;
	/**
	 * Overrides the auto-generated random id with a caller-supplied constant.
	 * Since sileo REPLACES whatever toast already occupies a given id slot
	 * (see the doc comment above `generateToastId`), passing the SAME id
	 * across repeated calls collapses them into one toast instead of
	 * stacking — e.g. the query-cache error handler's "Connection lost"
	 * toast during a network drop (libs/orpc/query-client.ts).
	 */
	id?: string;
};

/**
 * Sileo defaults every toast without an explicit `id` to one shared
 * `"sileo-default"` slot (node_modules/sileo dist/index.mjs `createToast`),
 * silently REPLACING whatever toast is already showing there — including its
 * action button. Verified against the installed 0.1.5 runtime: `Toaster`
 * renders one `<Sileo>` element per distinct id, so unrelated toasts (e.g. a
 * query-error toast with a "Retry" action and a delete-success toast fired a
 * moment later) stack correctly once each call gets its own id — they only
 * collide because nothing ever set one. `id` isn't on the public
 * `SileoOptions` type (only `sileo.dismiss(id)`/`clear()` reference it) but
 * is read at runtime via `merged.id`, so it's carried through an extended
 * local type instead of an `any` cast.
 */
function generateToastId() {
	return crypto.randomUUID();
}

function fire(
	state: ToastState,
	{ title, description, action, duration, icon, id }: ToastOptions,
) {
	const payload: SileoOptions & { id: string } = {
		id: id ?? generateToastId(),
		title,
		description,
		duration,
		icon: icon ?? STATE_ICON[state],
		button: action
			? { title: action.label, onClick: action.onClick }
			: undefined,
	};
	return sileo[state](payload);
}

type PromiseMessages<T> = {
	loading: string;
	success: string | ((data: T) => string);
	error: string | ((error: unknown) => string);
};

/**
 * Typed toast helpers — the ONLY toast import surface app-wide (auth views,
 * the query-client global error handler, Studio scene/version actions).
 */
export const toast = {
	success: (options: ToastOptions) => fire("success", options),
	error: (options: ToastOptions) => fire("error", options),
	warning: (options: ToastOptions) => fire("warning", options),
	info: (options: ToastOptions) => fire("info", options),
	promise: <T,>(
		value: Promise<T> | (() => Promise<T>),
		messages: PromiseMessages<T>,
	) => {
		// Sileo reuses this same id for the success/error transition
		// internally (it morphs the loading toast in place), so only the
		// loading phase needs an explicit id — see `generateToastId` above.
		const loading: SileoOptions & { id: string } = {
			id: generateToastId(),
			title: messages.loading,
			icon: STATE_ICON.loading,
		};
		return sileo.promise(value, {
			loading,
			success: (data) => ({
				title:
					typeof messages.success === "function"
						? messages.success(data)
						: messages.success,
				icon: STATE_ICON.success,
			}),
			error: (error) => ({
				title:
					typeof messages.error === "function"
						? messages.error(error)
						: messages.error,
				icon: STATE_ICON.error,
			}),
		});
	},
};

const AUTOPILOT = { expand: 400, collapse: 300 };

/**
 * Mounted once in components/providers.tsx. The app is dark-only
 * (`ThemeProvider` sets `forcedTheme="dark"` — see components/providers.tsx),
 * so `theme` is hardcoded instead of read from `next-themes`: `resolvedTheme`
 * would always resolve to `"dark"` anyway, and hardcoding drops the
 * `useTheme`/mounted-gate dance (and its SSR `null` first render) that only
 * existed to avoid a light/dark flash while a real theme choice was possible.
 * Dark-mode overrides stay unconditional: fill/text with shadcn tokens
 * (Sileo's default fill is #FFFFFF; https://sileo.aaryan.design/docs/styling).
 * No borders anywhere.
 */
export function Toaster() {
	return (
		<SileoToaster
			position="top-right"
			theme="dark"
			options={{
				autopilot: AUTOPILOT,
				fill: "var(--card)",
				roundness: 16,
				styles: {
					button: "bg-foreground/10! hover:bg-foreground/20!",
					description: "text-muted-foreground!",
					title: "text-foreground!",
				},
			}}
		/>
	);
}
