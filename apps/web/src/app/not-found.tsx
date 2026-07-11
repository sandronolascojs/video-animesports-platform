import { SearchXIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * App-wide 404 (Next.js `not-found.tsx`) — no nearer `not-found.tsx` exists
 * under `(private)`/`(shell)`/`(auth)`, so this root one catches every
 * unmatched URL and any `notFound()` call anywhere in the tree. Same card
 * recipe as the Studio's own not-found state
 * (`feature/studio/components/studio-not-found.tsx`: icon, copy, single
 * action) so both "this doesn't exist" surfaces in the app read as one
 * family.
 */
export default function NotFound() {
	return (
		<div className="flex min-h-svh flex-col items-center justify-center gap-4 p-8 text-center">
			<SearchXIcon className="size-10 text-muted-foreground/50" />
			<div className="flex flex-col gap-1">
				<h1 className="font-semibold text-lg">Page not found</h1>
				<p className="max-w-sm text-muted-foreground text-sm">
					This page doesn't exist, or the link is wrong.
				</p>
			</div>
			<Button asChild>
				<Link href="/">Back to home</Link>
			</Button>
		</div>
	);
}
