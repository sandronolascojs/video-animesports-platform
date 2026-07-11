import type { ReactNode } from "react";

import { AgentChatSidebar } from "@/feature/studio/components/agent-chat-sidebar";
import { StudioChatProvider } from "@/feature/studio/stores/studio-chat-provider";

export type StudioLayoutProps = Readonly<{
	children: ReactNode;
	params: Promise<{ projectId: string }>;
}>;

/**
 * Studio layout (docs/ai-architecture-v1.md §2 "Layout"): NO `AppSidebar` —
 * this route is a sibling of `(private)/(shell)/`, not nested inside it, so
 * it never renders that group's layout. Full-viewport flex row instead: the
 * editor (`children`, i.e. `StudioPage` → `StudioView`) takes the remaining
 * width, `AgentChatSidebar` docks on the right at a fixed width while open.
 *
 * `StudioChatProvider` is the dock↔sidebar exclusivity switch AND (AI-4) the
 * single chat owner — both `AgentChatSidebar` here and `StudioView`'s own
 * floating `AIDock` read it via `useStudioChat()` so the two surfaces share
 * one conversation and stay mutually exclusive (never both visible, per the
 * spec). `projectId` comes from this layout's own dynamic segment params
 * (Next.js passes `params` to every layout/page under `[projectId]`, not
 * just the leaf page).
 */
export default async function StudioLayout({
	children,
	params,
}: StudioLayoutProps) {
	const { projectId } = await params;

	// `key={projectId}` forces a full remount when navigating between two
	// projects that share this SAME layout instance — Next.js App Router
	// layouts do NOT remount on a dynamic-segment change by default, so
	// without this the provider's chat refs (message history, in-flight
	// state) would leak from the previous project into the next one.
	return (
		<StudioChatProvider key={projectId} projectId={projectId}>
			<div className="flex h-svh w-full">
				<div className="min-w-0 flex-1">{children}</div>
				<AgentChatSidebar />
			</div>
		</StudioChatProvider>
	);
}
