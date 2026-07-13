"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { TemplateKey } from "@video-platform-challenge/types";
import {
	AlertTriangleIcon,
	ClapperboardIcon,
	ImageIcon,
	type LucideIcon,
	SearchIcon,
} from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useState,
} from "react";

import { JewelIcon } from "@/components/kit/jewel-icon";
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@/components/ui/command";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
// Cross-feature imports (home owns template presentation + the projects
// hook; assets owns the flattened asset list) — the palette is a shared
// surface over both.
import { useAllAssets } from "@/feature/assets/hooks/http/use-all-assets";
import { useProjects } from "@/feature/home/hooks/http/use-projects";
import { SPORT_TEMPLATES } from "@/feature/home/sport-templates";
import { useDebounce } from "@/hooks/use-debounce";
import { useShortcut } from "@/hooks/use-platform";
import { orpc } from "@/libs/orpc";

const ASSET_KIND_ICON: Record<string, LucideIcon> = {
	character_sheet: ImageIcon,
	location_sheet: ImageIcon,
	keyframe: ImageIcon,
	scene_video: ClapperboardIcon,
	render: ClapperboardIcon,
};

function kindLabel(kind: string): string {
	const label = kind.replace(/_/g, " ");
	return label.charAt(0).toUpperCase() + label.slice(1);
}

// One display shape per group, whether the hit came from the server's fuzzy
// search or the local recent-5 fallback.
type ProjectHit = {
	id: string;
	title: string | null;
	templateKey: TemplateKey;
};

type AssetHit = {
	id: string;
	kind: string;
	projectTitle: string | null;
};

type CommandPaletteContextValue = {
	setOpen: (open: boolean) => void;
};

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
	null,
);

export function useCommandPalette(): CommandPaletteContextValue {
	const context = useContext(CommandPaletteContext);
	if (!context) {
		throw new Error(
			"useCommandPalette must be used within CommandPaletteProvider",
		);
	}
	return context;
}

/**
 * Global search over projects and assets — ⌘K/Ctrl+K from anywhere in the
 * private shell, or the sidebar's Search pill. Typing hits the server's
 * fuzzy `search.query` endpoint (debounced 250ms — `useDebounce` — so we
 * don't fire a request per keystroke); the empty palette always offers the
 * five most recent of each group instead of a void. cmdk's own filtering is
 * OFF (`shouldFilter={false}`) — the server decides what matches. Projects
 * open the Studio; assets open the Assets page with the asset's info panel
 * deep-linked (`?asset=`).
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const router = useRouter();

	useShortcut("k", () => setOpen((prev) => !prev));

	const debouncedQuery = useDebounce(query, 250);
	const searching = debouncedQuery.trim().length > 0;

	const { data: projects = [], isError: projectsError } = useProjects();
	const { assets: allAssets } = useAllAssets(open);

	const searchResults = useQuery({
		...orpc.search.query.queryOptions({
			input: { query: debouncedQuery.trim() },
		}),
		enabled: open && searching,
		// Keep the previous hits on screen while the next request is in
		// flight — no flicker between keystrokes.
		placeholderData: keepPreviousData,
	});

	const projectHits: ProjectHit[] = searching
		? (searchResults.data?.projects ?? [])
		: projects.slice(0, 5);

	const recentAssets: AssetHit[] = [...allAssets]
		.sort((a, b) => b.asset.createdAt.getTime() - a.asset.createdAt.getTime())
		.slice(0, 5)
		.map(({ asset, projectTitle }) => ({
			id: asset.id,
			kind: asset.kind,
			projectTitle,
		}));

	const assetHits: AssetHit[] = searching
		? (searchResults.data?.assets ?? [])
		: recentAssets;

	// M4/M8 fix-pass: an empty `projectHits`/`assetHits` used to always read
	// as "No results found" — including when the underlying fetch actually
	// FAILED (both `useProjects()` and `orpc.search.query` default `data` on
	// error, same shape as a genuine empty result). Track the fetch that's
	// actually driving the current view (recent list vs. active search) so
	// the void state can tell the two apart.
	const hasError = searching ? searchResults.isError : projectsError;

	const contextValue = useMemo(() => ({ setOpen }), []);

	const onOpenChange = (next: boolean) => {
		setOpen(next);
		if (!next) {
			setQuery("");
		}
	};

	// Generic-over-Route is typed-routes' documented pattern for dynamic
	// hrefs — the template literal is validated against the route table.
	const go = <T extends string>(href: Route<T>) => {
		onOpenChange(false);
		router.push(href);
	};

	return (
		<CommandPaletteContext.Provider value={contextValue}>
			{children}
			{/* +50% width over the sm:max-w-sm base, +25% height over the
			    max-h-72 list default (user call). */}
			<CommandDialog
				open={open}
				onOpenChange={onOpenChange}
				className="sm:max-w-xl"
			>
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="Search projects and assets…"
						value={query}
						onValueChange={setQuery}
					/>
					<CommandList className="max-h-[22.5rem]">
						<CommandEmpty className="py-2">
							{/* shadcn Empty (icon chip + title + copy, no action — user
							    call): the void teaches instead of shrugging. `hasError`
							    branches this to distinct copy so a failed fetch never
							    reads as "you have nothing yet" (M4/M8 fix-pass). */}
							<Empty className="p-6">
								<EmptyHeader>
									<EmptyMedia variant="icon">
										{hasError ? <AlertTriangleIcon /> : <SearchIcon />}
									</EmptyMedia>
									<EmptyTitle>
										{hasError
											? "Something went wrong"
											: searching && searchResults.isFetching
												? "Searching…"
												: "No results found"}
									</EmptyTitle>
									<EmptyDescription>
										{hasError
											? "Couldn't load results — try again in a moment."
											: searching
												? "Try a different name, sport or asset type."
												: "Create your first project and it will show up here."}
									</EmptyDescription>
								</EmptyHeader>
							</Empty>
						</CommandEmpty>
						{projectHits.length > 0 ? (
							<CommandGroup
								heading={searching ? "Projects" : "Recent projects"}
							>
								{projectHits.map((project) => {
									const template = SPORT_TEMPLATES.find(
										(candidate) => candidate.key === project.templateKey,
									);
									const title = project.title ?? "Untitled project";
									return (
										<CommandItem
											key={project.id}
											value={`project-${project.id}`}
											onSelect={() => go(`/projects/${project.id}`)}
											className="gap-3"
										>
											<JewelIcon
												icon={template?.icon ?? ClapperboardIcon}
												from={template?.gradient.from}
												to={template?.gradient.to}
												size={26}
											/>
											<span className="min-w-0 flex-1">
												<span className="block truncate font-medium">
													{title}
												</span>
												<span className="block truncate text-muted-foreground text-xs">
													{template?.name ?? "Project"}
												</span>
											</span>
											<span className="text-muted-foreground text-xs">
												Studio
											</span>
										</CommandItem>
									);
								})}
							</CommandGroup>
						) : null}
						{projectHits.length > 0 && assetHits.length > 0 ? (
							<CommandSeparator />
						) : null}
						{assetHits.length > 0 ? (
							<CommandGroup heading={searching ? "Assets" : "Recent assets"}>
								{assetHits.map((asset) => (
									<CommandItem
										key={asset.id}
										value={`asset-${asset.id}`}
										onSelect={() => go(`/assets?asset=${asset.id}`)}
										className="gap-3"
									>
										<JewelIcon
											icon={ASSET_KIND_ICON[asset.kind] ?? ImageIcon}
											from="var(--chart-3)"
											to="var(--chart-5)"
											size={26}
										/>
										<span className="min-w-0 flex-1">
											<span className="block truncate font-medium">
												{kindLabel(asset.kind)}
											</span>
											<span className="block truncate text-muted-foreground text-xs">
												{asset.projectTitle ?? "Untitled project"}
											</span>
										</span>
										<span className="text-muted-foreground text-xs">
											Assets
										</span>
									</CommandItem>
								))}
							</CommandGroup>
						) : null}
					</CommandList>
					{/* Footer hints — the palette teaches its own keys. */}
					<div className="flex items-center gap-4 border-border/60 border-t px-4 py-2 text-muted-foreground text-xs">
						<span className="flex items-center gap-1.5">
							<Kbd>↑</Kbd>
							<Kbd>↓</Kbd>
							Navigate
						</span>
						<span className="flex items-center gap-1.5">
							<Kbd>↵</Kbd>
							Open
						</span>
						<span className="flex items-center gap-1.5">
							<Kbd>esc</Kbd>
							Close
						</span>
					</div>
				</Command>
			</CommandDialog>
		</CommandPaletteContext.Provider>
	);
}
