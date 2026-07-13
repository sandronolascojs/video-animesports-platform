import type { CSSProperties, ReactNode } from "react";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AgentChatSidebar } from "@/feature/studio/components/agent-chat-sidebar";
import { StudioChatProvider } from "@/feature/studio/stores/studio-chat-provider";

export type StudioLayoutProps = Readonly<{
	children: ReactNode;
	params: Promise<{ projectId: string }>;
}>;

/**
 * Studio layout (docs/ai-architecture-v1.md §2 "Layout"): NO `AppSidebar` —
 * this route is a sibling of `(private)/(shell)/`, not nested inside it, so
 * it never renders that group's layout or `SidebarProvider`. It gets its OWN
 * right-side `SidebarProvider` instead, scoped entirely to this route's
 * subtree — a totally separate `SidebarContext` from the shell's left one, so
 * the two never collide even though both are built on the same
 * `components/ui/sidebar.tsx` primitive (React context, not a page-global
 * singleton — this is exactly how the primitive supports more than one
 * independent sidebar). `--sidebar-width` is overridden to 23rem here (see
 * `AgentChatSidebar`'s doc comment for why); `--sidebar-width-icon` stays the
 * shared default so the collapsed rail matches `AppSidebar`'s own icon-rail
 * width.
 *
 * `SidebarInset` (a semantic `<main>`) takes `children` (`StudioPage` →
 * `StudioView`: topbar + panels + timeline) as the left/flex-1 side;
 * `AgentChatSidebar` docks on the right as the `Sidebar` itself — both are
 * flex siblings inside the provider's own wrapper, exactly mirroring how
 * `(shell)/layout.tsx` pairs `AppSidebar` + `SidebarInset`.
 *
 * `StudioChatProvider` is the single chat owner (docs/studio-design-language.md
 * §3d: there is no floating dock anymore, `AgentChatSidebar` here is the
 * Studio's only chat surface) AND now reads/drives the rail's open/collapsed
 * state through this `SidebarProvider` (`useSidebar()` inside
 * `StudioChatProvider` — see its own doc comment): the rail's `SidebarTrigger`
 * and the provider's ⌘J shortcut both end up toggling the SAME state.
 * `StudioChatProvider` has to be nested INSIDE `SidebarProvider` (not the
 * other way around) for that `useSidebar()` call to resolve. `projectId`
 * comes from this layout's own dynamic segment params (Next.js passes
 * `params` to every layout/page under `[projectId]`, not just the leaf page).
 */
export default async function StudioLayout({
	children,
	params,
}: StudioLayoutProps) {
	const { projectId } = await params;

	return (
		// `h-svh` (not the primitive's own default `min-h-svh`): Studio needs a
		// firm viewport anchor for its internal panels to scroll instead of
		// growing the page (same reasoning as `StudioView`'s own root — see its
		// doc comment), so this override matches that same firm anchor one
		// level up.
		<SidebarProvider
			className="h-svh"
			style={{ "--sidebar-width": "23rem" } as CSSProperties}
		>
			{/* `key={projectId}` forces a full remount of the chat owner when
			    navigating between two projects that share this SAME layout
			    instance — Next.js App Router layouts do NOT remount on a
			    dynamic-segment change by default, so without this the provider's
			    chat refs (message history, in-flight state) would leak from the
			    previous project into the next one. Scoped to `StudioChatProvider`
			    only (not the `SidebarProvider` above it) — the rail's own
			    open/collapsed state is a UI preference, not per-project state, and
			    shouldn't reset on navigation. */}
			<StudioChatProvider key={projectId} projectId={projectId}>
				<SidebarInset className="min-w-0">{children}</SidebarInset>
				<AgentChatSidebar />
			</StudioChatProvider>
		</SidebarProvider>
	);
}
