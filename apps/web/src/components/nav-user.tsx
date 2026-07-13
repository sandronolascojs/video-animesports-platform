"use client";

import { ChevronsUpDownIcon, LogOutIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { AgentAvatar } from "@/components/ui/agent-avatar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";
import { authClient } from "@/libs/auth/client";
import { toast } from "@/libs/toast";

const AVATAR_PX = 32;

export type NavUserData = {
	name: string;
	email: string;
	/** Absent/null for accounts with no uploaded avatar — falls back to `AgentAvatar`. */
	image?: string | null;
};

/**
 * Avatar used both by the trigger button and the dropdown's identity label
 * (Task spec: "for BOTH the trigger button and the dropdown label"). With an
 * image, a normal `AvatarImage` (Radix Fallback covers load failures). With
 * no image, `AgentAvatar` renders directly in place of the whole `Avatar` —
 * not nested inside Radix's `AvatarFallback`, which only mounts after its
 * own internal load-failure delay and would delay/hide the canvas.
 */
function UserAvatar({ user }: { user: NavUserData }) {
	if (!user.image) {
		return (
			<AgentAvatar
				seed={user.email}
				size={AVATAR_PX}
				className="shrink-0 rounded-lg"
			/>
		);
	}

	const initials = (user.name || user.email || "?").slice(0, 2).toUpperCase();

	return (
		<Avatar className="size-8 rounded-lg">
			<AvatarImage src={user.image} alt={user.name} />
			<AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
		</Avatar>
	);
}

/**
 * Sidebar-footer identity + account menu — adapted from the shadcn `NavUser`
 * block (see the sidebar-reference scratchpad): `SidebarMenuButton size="lg"`
 * trigger (avatar + name/email + `ChevronsUpDown`), opening a `DropdownMenu`
 * anchored `side="right"` on desktop / `"bottom"` on mobile via `useSidebar()`.
 * Trimmed to what this app actually has: an identity header (no Upgrade/
 * Billing/Notifications/Account stubs — those were reference-only) plus
 * "Log out", reusing the exact sign-out call the old `user-menu.tsx` used
 * (`authClient.signOut` → `router.push("/")`; the `(private)` layout's SSR
 * `enforceAuth()` guard then redirects that same navigation on to `/login`
 * once the session is gone, so the effective destination is `/login`).
 *
 * `user` comes from the server-rendered session, threaded down through
 * `(private)/layout.tsx` → `AppSidebar` → here — never refetched client-side.
 *
 * Sign-out navigates straight to `/login` — not `/`. Pushing back to `/`
 * (the dashboard, i.e. wherever NavUser's footer already lives) relied on
 * `(private)/layout.tsx`'s `enforceAuth()` SSR guard to bounce the user on
 * to `/login`; but when the user is already ON `/`, a same-pathname
 * `router.push("/")` is a client-router no-op, so that guard never gets a
 * fresh server round-trip to actually run — confirmed live: the dashboard
 * stayed put, still showing the signed-out user, until a manual hard
 * reload. `router.refresh()` after the push forces a fresh RSC fetch for
 * `/login` so the router cache can't serve a stale payload either.
 */
export function NavUser({ user }: { user: NavUserData }) {
	const router = useRouter();
	const { isMobile } = useSidebar();

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							size="lg"
							className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
						>
							<UserAvatar user={user} />
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-medium">{user.name}</span>
								<span className="truncate text-xs">{user.email}</span>
							</div>
							<ChevronsUpDownIcon className="ml-auto size-4" />
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg bg-card"
						side={isMobile ? "bottom" : "right"}
						align="end"
						sideOffset={4}
					>
						<DropdownMenuLabel className="p-0 font-normal">
							<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
								<UserAvatar user={user} />
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-medium">{user.name}</span>
									<span className="truncate text-xs">{user.email}</span>
								</div>
							</div>
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuItem
								variant="destructive"
								onClick={() => {
									authClient.signOut({
										fetchOptions: {
											onSuccess: () => {
												router.push("/login");
												router.refresh();
											},
											// m4 fix: signOut had no failure path — a rejected
											// request (network drop, server error) used to fail
											// silently, leaving the user stuck on the same page
											// with no feedback and no session actually cleared.
											onError: () => {
												toast.error({
													title: "Couldn't sign out",
													description: "Please try again.",
												});
											},
										},
									});
								}}
							>
								<LogOutIcon />
								Log out
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
