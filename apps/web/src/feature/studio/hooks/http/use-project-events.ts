"use client";

import { useQueryClient } from "@tanstack/react-query";
import { projectEventSchema } from "@video-platform-challenge/api";
import { env } from "@video-platform-challenge/env/web";
import { useEffect } from "react";

import { orpc } from "@/libs/orpc";
import { getServerUrl } from "@/libs/utils";

/**
 * RT-3's SSE fast path (docs realtime-and-render-lock-v1.md §1 piece 6):
 * opens one `EventSource` per mounted project — `withCredentials` so the
 * Better Auth session cookie rides along, same auth model as the oRPC client
 * (`libs/orpc/client.ts`) and the agent chat transport
 * (`studio-chat-provider.tsx`). v1 is invalidate-on-event, not
 * field-patching (doc's own "Non-goals for v1"): every parsed event just
 * invalidates `projects.get`, and the existing `applyServerSnapshot`
 * reconcile (draft-store-provider.tsx's `ProjectSync`) does the rest on its
 * next refetch. Postgres stays the source of truth — a message that fails
 * `projectEventSchema` (or isn't even valid JSON) is logged and ignored
 * rather than trusted directly. `use-project.ts`'s slow fallback poll is
 * what guarantees eventual consistency if this connection never opens at
 * all (mobile background, a proxy that kills SSE, the DO itself unreachable
 * — docs "Non-goals for v1": "if [the DO] is ever unavailable the slow poll
 * still works").
 */
export function useProjectEvents(projectId: string): void {
	const queryClient = useQueryClient();

	// `queryClient` is a stable singleton for the app's lifetime (see
	// libs/orpc/query-client.ts) — only `projectId` should tear down and
	// reopen the connection.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
	useEffect(() => {
		function invalidate() {
			queryClient.invalidateQueries({
				queryKey: orpc.projects.get.queryOptions({ input: { id: projectId } })
					.queryKey,
			});
		}

		const source = new EventSource(
			`${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/projects/${projectId}/events`,
			{ withCredentials: true },
		);

		// Distinguishes the FIRST connect (nothing missed yet — the caller's
		// own SSR/initial fetch already has a fresh snapshot) from a RECONNECT
		// after a drop (docs: "on error just let it, and do one
		// invalidateQueries on reopen to catch anything missed").
		let hasConnectedOnce = false;
		source.onopen = () => {
			if (hasConnectedOnce) {
				invalidate();
			}
			hasConnectedOnce = true;
		};

		source.onmessage = (message) => {
			let parsed: unknown;
			try {
				parsed = JSON.parse(message.data);
			} catch {
				console.error(
					"[use-project-events] malformed SSE payload",
					message.data,
				);
				return;
			}
			const result = projectEventSchema.safeParse(parsed);
			if (!result.success) {
				console.error("[use-project-events] event failed schema", result.error);
				return;
			}
			invalidate();
		};

		// No explicit handling beyond logging: `EventSource` retries on its
		// own, and `onopen` above already invalidates once reconnected — the
		// slow fallback poll covers the gap in the meantime.
		source.onerror = () => {
			console.error(`[use-project-events] connection error for ${projectId}`);
		};

		return () => {
			source.close();
		};
	}, [projectId]);
}
