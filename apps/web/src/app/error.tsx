"use client";

import { OctagonXIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * Route-segment error boundary (Next.js `error.tsx`): catches render errors
 * anywhere under the root layout and swaps them for this branded fallback
 * instead of the framework's default error overlay/blank screen. Mirrors
 * `StudioNotFound`'s card recipe (icon, copy, action) — matches
 * `not-found.tsx`'s same treatment — so every "this route broke" surface in
 * the app reads as one family. Root layout (fonts, `Providers`, `Toaster`)
 * still renders around this — only the segment that threw is replaced — so
 * the app's design tokens/Tailwind utilities are available here, unlike
 * `global-error.tsx`.
 */
export default function RouteError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<div className="flex min-h-svh flex-col items-center justify-center gap-4 p-8 text-center">
			<div className="surface-panel flex max-w-sm flex-col items-center gap-4 px-8 py-10">
				<OctagonXIcon className="size-10 text-destructive/70" />
				<div className="flex flex-col gap-1">
					<h1 className="font-semibold text-lg">Something went wrong</h1>
					<p className="text-muted-foreground text-sm">
						An unexpected error interrupted this page. You can try again, or
						head back to safety.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button onClick={() => reset()}>Try again</Button>
					<Button asChild variant="outline">
						<Link href="/">Back to home</Link>
					</Button>
				</div>
			</div>
		</div>
	);
}
