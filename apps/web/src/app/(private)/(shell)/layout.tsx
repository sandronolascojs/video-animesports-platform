import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import type { NavUserData } from "@/components/nav-user";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import { getServerSession } from "@/libs/auth/server";

/**
 * The app-sidebar shell (docs/ai-architecture-v1.md §2 "Layout"): moved
 * DOWN here from `(private)/layout.tsx` so `(shell)` is the ONE route group
 * that opts into `AppSidebar` — Dashboard (`/`), Projects list (`/projects`)
 * and Assets (`/assets`) live inside it; the Studio
 * (`projects/[projectId]/`) stays a sibling of `(shell)` under `(private)`
 * and never renders this layout, so it gets no app sidebar.
 *
 * `(private)/layout.tsx` above this one already enforces the session guard
 * (`enforceAuth()` redirects before `children` renders), so the
 * `getServerSession()` call here is a same-request `cache()` dedupe (no
 * extra network round trip) used only to read the fields `AppSidebar`'s user
 * menu needs. The `redirect` fallback mirrors the parent layout's — dead in
 * practice, kept for type-safety without a non-null assertion.
 */
export default async function ShellLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const session = await getServerSession();

	if (!session?.user) {
		redirect("/login");
	}

	const user: NavUserData = {
		email: session.user.email,
		image: session.user.image,
		name: session.user.name,
	};

	return (
		// `min-h-svh` per docs/studio-ui.md "Layout sizing rule": shells adjust
		// to the viewport, they never clip it. Views that need a firm
		// viewport-height anchor for internal scroll regions establish it
		// locally on their own root element instead of forcing every shelled
		// route into a fixed-height shell.
		<SidebarProvider className="min-h-svh">
			<AppSidebar user={user} />
			{/* The elevated content card without its own border — the hero section
			    draws the fading border ring INSIDE the scroller so it scrolls away
			    with the hero instead of sticking to the viewport. */}
			<SidebarInset className="relative my-2 mr-2 overflow-hidden rounded-2xl bg-sidebar shadow-none">
				{/*
				 * Mobile-only trigger strip. The sidebar's own `SidebarTrigger`
				 * lives inside its header — unreachable once the mobile Sheet is
				 * closed (its default state), which made the whole sidebar (nav,
				 * search, new-project, NavUser/logout) unreachable below `md`.
				 * Desktop already has that sidebar-internal trigger visible at all
				 * times, so this strip only renders below `md`.
				 */}
				<header className="flex h-12 shrink-0 items-center gap-2 border-sidebar-border border-b px-2 md:hidden">
					<SidebarTrigger />
				</header>
				{children}
			</SidebarInset>
		</SidebarProvider>
	);
}
