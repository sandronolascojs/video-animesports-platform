import { CommandPaletteProvider } from "@/components/kit/command-palette";
import { enforceAuth } from "@/libs/auth/server";

/**
 * Server-level auth guard for the whole `(private)` route group (studio-ui.md
 * "Auth guard (SSR)"): `enforceAuth()` resolves the session over SSR and
 * `redirect("/login")`s when absent — no private page ever renders without a
 * session, since the redirect happens before `children` is returned.
 *
 * This layout stays deliberately thin (docs/ai-architecture-v1.md §2
 * "Layout"): auth + the cross-cutting `CommandPaletteProvider` (⌘K needs to
 * work in the Studio too, which has no `AppSidebar` search pill to open it
 * from) ONLY. The `AppSidebar`/`SidebarProvider`/`SidebarInset` shell moved
 * DOWN into `(shell)/layout.tsx` so the Studio route
 * (`projects/[projectId]/`), a sibling of `(shell)` and NOT nested inside
 * it, never renders an app sidebar. The global create-project dock/provider
 * that used to live here (docs scenes-architecture-v3.md A6) is gone
 * (docs/ai-architecture-v1.md §1 "kill the global dock") — the sidebar's
 * "New project" pill now opens `CreateProjectModalProvider`'s modal instead,
 * which is mounted app-wide in `components/providers.tsx`.
 */
export default async function PrivateLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	await enforceAuth();

	return <CommandPaletteProvider>{children}</CommandPaletteProvider>;
}
