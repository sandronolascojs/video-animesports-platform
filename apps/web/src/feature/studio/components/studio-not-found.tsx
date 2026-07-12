import { FilmIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/** Unknown projectId → designed not-found state (docs/studio-ui.md §1). */
export function StudioNotFound({ projectId }: { projectId: string }) {
	return (
		<div className="flex min-h-[70svh] flex-col items-center justify-center gap-4 p-8 text-center">
			<FilmIcon className="size-10 text-muted-foreground/50" />
			<div className="flex flex-col gap-1">
				<h1 className="font-semibold text-lg">Project not found</h1>
				<p className="max-w-sm text-muted-foreground text-sm">
					"{projectId}" doesn't match any project. It may have been deleted, or
					the link is wrong.
				</p>
			</div>
			<Button asChild>
				<Link href="/">Back to Home</Link>
			</Button>
		</div>
	);
}
