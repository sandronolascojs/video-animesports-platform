"use client";

import {
	AlertTriangleIcon,
	FolderIcon,
	ImagesIcon,
	LayoutDashboard,
	MoreHorizontal,
	PlusIcon,
	SearchIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type * as React from "react";

import { AppLogo } from "@/components/kit/app-logo";
import { useCommandPalette } from "@/components/kit/command-palette";
import { useCreateProjectModal } from "@/components/kit/create-project-modal";
import { JewelIcon } from "@/components/kit/jewel-icon";
import type { NavUserData } from "@/components/nav-user";
import { NavUser } from "@/components/nav-user";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { FOCUS_COMPOSER_EVENT } from "@/constants/app.constants";
import { useProjects } from "@/feature/home/hooks/http/use-projects";
import { usePlatform } from "@/hooks/use-platform";
import { cn } from "@/libs/utils";

export type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
	user: NavUserData;
};

/**
 * "New project" — a prominent rounded-full pill, not a standard
 * SidebarMenuButton row (Higgsfield reference). Collapses to a centered
 * jewel `+` chip in icon rail mode via the same `group-data-[collapsible]`
 * selectors the shadcn Sidebar primitives use, so it collapses/expands in
 * lockstep with the rest of the rail. A `button` (not a `<Link href="/">`) —
 * it branches by the CURRENT route (docs/ai-architecture-v1.md §1
 * "focusNewProject() routing logic simplifies to"): Home dispatches
 * `FOCUS_COMPOSER_EVENT` to focus its own hero composer, everywhere else
 * (Studio included — creating a new project from inside a project is a
 * modal case) opens `CreateProjectModalProvider`'s modal.
 */
function NewProjectPill() {
	const { modLabel } = usePlatform();
	const pathname = usePathname();
	const { open } = useCreateProjectModal();

	const focusNewProject = () => {
		if (pathname === "/") {
			window.dispatchEvent(new CustomEvent(FOCUS_COMPOSER_EVENT));
			return;
		}
		open();
	};

	return (
		<button
			type="button"
			onClick={focusNewProject}
			className={cn(
				"group/pill flex h-10 w-full items-center gap-2 rounded-full border border-transparent bg-white/5 px-2 text-left transition-colors duration-150 ease-out hover:bg-white/10",
				"group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
			)}
		>
			<JewelIcon
				icon={PlusIcon}
				size={24}
				from="var(--chart-1)"
				to="var(--chart-2)"
				className="shrink-0"
			/>
			<span className="min-w-0 flex-1 truncate font-medium text-sm group-data-[collapsible=icon]:hidden">
				New project
			</span>
			<Kbd className="opacity-0 transition-opacity duration-150 ease-out group-hover/pill:opacity-100 group-data-[collapsible=icon]:hidden">
				{modLabel} ↵
			</Kbd>
		</button>
	);
}

/**
 * Search — the SAME pill treatment as New project (Higgsfield reference:
 * the two rows read as siblings) with the platform-aware ⌘K/Ctrl+K hint.
 * Opens the global command palette.
 */
function SearchPill() {
	const { modLabel } = usePlatform();
	const { setOpen } = useCommandPalette();

	return (
		<button
			type="button"
			onClick={() => setOpen(true)}
			className={cn(
				"group/pill flex h-10 w-full items-center gap-2 rounded-full border border-transparent bg-white/5 px-2 text-left transition-colors duration-150 ease-out hover:bg-white/10",
				"group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
			)}
		>
			<span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
				<SearchIcon className="size-4" />
			</span>
			<span className="min-w-0 flex-1 truncate font-medium text-muted-foreground text-sm group-data-[collapsible=icon]:hidden">
				Search
			</span>
			<Kbd className="opacity-0 transition-opacity duration-150 ease-out group-hover/pill:opacity-100 group-data-[collapsible=icon]:hidden">
				{modLabel} K
			</Kbd>
		</button>
	);
}

function RecentProjectsEmptyState() {
	return (
		<div className="flex flex-col items-center gap-2 rounded-xl border border-border/60 border-dashed px-3 py-4 text-center group-data-[collapsible=icon]:hidden">
			<FolderIcon className="size-5 text-muted-foreground/60" />
			<p className="text-muted-foreground text-xs leading-snug">
				No projects yet
				<br />
				Create one to get started
			</p>
		</div>
	);
}

/**
 * M4/M8 fix-pass: `NavRecentProjects` used to fall back to
 * `RecentProjectsEmptyState`'s "No projects yet" copy on a FAILED
 * `useProjects()` fetch too (its `data = []` default masks the error) — a
 * network drop read exactly like a brand-new account. Distinct copy + a
 * retry so a fetch failure doesn't lie to the user.
 */
function RecentProjectsErrorState({ onRetry }: { onRetry: () => void }) {
	return (
		<div className="flex flex-col items-center gap-2 rounded-xl border border-destructive/30 border-dashed px-3 py-4 text-center group-data-[collapsible=icon]:hidden">
			<AlertTriangleIcon className="size-5 text-destructive/70" />
			<p className="text-muted-foreground text-xs leading-snug">
				Couldn't load projects
			</p>
			<button
				type="button"
				onClick={onRetry}
				className="text-primary text-xs underline-offset-4 hover:underline"
			>
				Retry
			</button>
		</div>
	);
}

/**
 * "Platform" group — just the Dashboard link. The v1 mock also had a
 * "Projects" collapsible (a single hardcoded sub-item) and a "Studio" link
 * both pointing at the one seeded demo project — dropped in front-wiring
 * phase 1: with real, possibly-many projects there's no single "the"
 * project for either link to point at, and `NavRecentProjects` below already
 * covers "browse real projects." No active-route highlighting: there's no
 * existing `usePathname`-based convention anywhere else in this app to
 * reuse, so a plain link row keeps this consistent with the rest of the
 * sidebar rather than inventing a new pattern here.
 */
function NavMain() {
	return (
		<SidebarGroup>
			<SidebarGroupLabel>Platform</SidebarGroupLabel>
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton asChild tooltip="Dashboard">
						<Link href="/">
							<LayoutDashboard />
							<span>Dashboard</span>
						</Link>
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton asChild tooltip="Projects">
						<Link href="/projects">
							<FolderIcon />
							<span>Projects</span>
						</Link>
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton asChild tooltip="Assets">
						<Link href="/assets">
							<ImagesIcon />
							<span>Assets</span>
						</Link>
					</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>
		</SidebarGroup>
	);
}

/**
 * "Recent" group — NavProjects.tsx reference pattern: per-row
 * `SidebarMenuAction showOnHover` opening a `DropdownMenu`. Trimmed to the
 * two actions this app actually supports: "Open" (navigates) and a disabled
 * "Delete" stub. Radix sets `pointer-events-none` on a disabled
 * `DropdownMenuItem` (see its `data-disabled:pointer-events-none` class in
 * `ui/dropdown-menu.tsx`), which would normally also swallow hover and keep
 * a wrapping `Tooltip` from ever firing. Wrapping the disabled item in a
 * plain `span` (which keeps pointer-events) and making that span the
 * `TooltipTrigger` sidesteps the issue: the span still receives the hover,
 * the item inside just visually/functionally ignores clicks.
 *
 * Data comes straight from the client `useProjects()` hook (docs' "keep it
 * simple: client hook reuse") rather than an SSR prefetch — the private
 * layout that renders this sidebar has no per-route prefetch hook, and
 * TanStack Query already shares this exact cache entry with Home's own
 * prefetched `projects.list` query when the user navigates between routes.
 */
function NavRecentProjects() {
	const { data: projects = [], isError, refetch } = useProjects();

	return (
		<SidebarGroup className="group-data-[collapsible=icon]:hidden">
			<SidebarGroupLabel>Recent</SidebarGroupLabel>
			{isError ? (
				<RecentProjectsErrorState onRetry={() => refetch()} />
			) : projects.length > 0 ? (
				<SidebarMenu>
					{projects.map((project) => (
						<SidebarMenuItem key={project.id}>
							<SidebarMenuButton
								asChild
								tooltip={project.title ?? "Untitled project"}
							>
								<Link href={`/projects/${project.id}`}>
									<span
										aria-hidden
										className="size-4 shrink-0 rounded-[0.3rem]"
										style={{
											backgroundImage:
												"linear-gradient(135deg, var(--chart-1), var(--chart-2))",
										}}
									/>
									<span className="truncate">
										{project.title ?? "Untitled project"}
									</span>
								</Link>
							</SidebarMenuButton>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<SidebarMenuAction showOnHover>
										<MoreHorizontal />
										<span className="sr-only">More</span>
									</SidebarMenuAction>
								</DropdownMenuTrigger>
								<DropdownMenuContent side="right" align="start">
									<DropdownMenuItem asChild>
										<Link href={`/projects/${project.id}`}>Open</Link>
									</DropdownMenuItem>
									<Tooltip>
										<TooltipTrigger asChild>
											<span>
												<DropdownMenuItem disabled>Delete</DropdownMenuItem>
											</span>
										</TooltipTrigger>
										<TooltipContent side="right">Coming in v2</TooltipContent>
									</Tooltip>
								</DropdownMenuContent>
							</DropdownMenu>
						</SidebarMenuItem>
					))}
				</SidebarMenu>
			) : (
				<RecentProjectsEmptyState />
			)}
		</SidebarGroup>
	);
}

/**
 * Global app rail — floating `variant="floating"` card, `collapsible="icon"`,
 * expanded by default (~16rem). Structure top→bottom per
 * docs/studio-ui.md "Sidebar (shadcn Sidebar, Higgsfield-style)": header
 * (logo + collapse toggle), New project pill, Search stub, Platform group,
 * Recent group, footer (user menu — dark-only app, no theme toggle). Lucide
 * icons only, shadcn `Sidebar` primitives throughout — never hand-rolled.
 */
export function AppSidebar({ user, ...props }: AppSidebarProps) {
	return (
		<Sidebar
			collapsible="icon"
			variant="floating"
			className="[&_[data-sidebar=sidebar]]:overflow-hidden [&_[data-sidebar=sidebar]]:rounded-2xl [&_[data-sidebar=sidebar]]:border [&_[data-sidebar=sidebar]]:border-sidebar-border [&_[data-sidebar=sidebar]]:shadow-none [&_[data-sidebar=sidebar]]:ring-0"
			{...props}
		>
			<SidebarHeader>
				<div className="flex items-center justify-between gap-2 px-1 py-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-2">
					<Link
						href="/"
						className="min-w-0 group-data-[collapsible=icon]:hidden"
					>
						<AppLogo size={26} />
					</Link>
					<SidebarTrigger className="shrink-0" />
				</div>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					{/* gap-2 between the two pills — they read as one action
					    cluster, not a cramped stack (user call, Higgsfield ref). */}
					<SidebarMenu className="gap-2">
						<SidebarMenuItem>
							<NewProjectPill />
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SearchPill />
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroup>

				<NavMain />
				<NavRecentProjects />
			</SidebarContent>
			<SidebarFooter>
				<NavUser user={user} />
			</SidebarFooter>
		</Sidebar>
	);
}
