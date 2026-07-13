"use client";

import type {
	ProjectDetail,
	ProjectSummary,
} from "@video-platform-challenge/api";
import { AssetKind, AssetStatus } from "@video-platform-challenge/types";
import {
	ClapperboardIcon,
	FolderIcon,
	ImageIcon,
	type LucideIcon,
	SparklesIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { ErrorStateCard } from "@/components/kit/error-state-card";
import { JewelIcon } from "@/components/kit/jewel-icon";
import { ShowMore } from "@/components/kit/show-more";
import { SPORT_TEMPLATES } from "@/feature/home/sport-templates";
// Cross-feature import (studio owns asset URLs): the dashboard previews the
// same signed thumbnails the Studio renders — one hook, one TTL policy.
import { useAssetUrl } from "@/feature/studio/hooks/http/use-asset-url";

/* -------------------------------------------------------------------------- */
/* Section chrome (Higgsfield register: jewel icon + uppercase header)        */
/* -------------------------------------------------------------------------- */

export function SectionHeader({
	icon,
	title,
	from,
	to,
}: {
	icon: LucideIcon;
	title: string;
	from: string;
	to: string;
}) {
	return (
		<div className="flex items-center gap-3">
			<JewelIcon icon={icon} from={from} to={to} size={34} />
			<h2 className="font-bold text-xl uppercase tracking-tight">{title}</h2>
		</div>
	);
}

export function EmptyStateCard({
	icon: Icon,
	title,
	hint,
}: {
	icon: LucideIcon;
	title: string;
	hint: string;
}) {
	return (
		<div className="flex flex-col items-center gap-3 rounded-2xl border border-border/60 border-dashed px-6 py-14 text-center">
			<Icon className="size-6 text-muted-foreground/60" />
			<div>
				<p className="font-medium text-sm">{title}</p>
				<p className="mt-1 text-muted-foreground text-sm">{hint}</p>
			</div>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Projects                                                                   */
/* -------------------------------------------------------------------------- */

function statusLabel(status: string): string {
	return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
}

export function ProjectMediaCard({ project }: { project: ProjectSummary }) {
	const template = SPORT_TEMPLATES.find(
		(candidate) => candidate.key === project.templateKey,
	);

	return (
		<div className="glass-edge flex flex-col gap-3 rounded-2xl bg-card/50 p-3">
			{/* Media area — template artwork until real render thumbnails exist. */}
			<div className="relative aspect-video overflow-hidden rounded-xl">
				{template?.hasStill ? (
					<Image
						src={`/templates/${template.key}-v2.png`}
						alt={template.name}
						fill
						sizes="480px"
						className="object-cover"
					/>
				) : (
					<div className="absolute inset-0 bg-gradient-to-br from-chart-1 to-chart-2" />
				)}
				<div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.45),transparent_45%)]" />
				<span className="absolute bottom-2 left-3 font-medium text-sm text-white">
					{statusLabel(project.status)} · {project.aspectRatio}
				</span>
			</div>
			{/* Footer row: jewel + names left, action pill right. */}
			<div className="flex items-center gap-3">
				{template ? (
					<JewelIcon
						icon={template.icon}
						from={template.gradient.from}
						to={template.gradient.to}
						size={34}
					/>
				) : (
					<JewelIcon icon={FolderIcon} size={34} />
				)}
				<div className="min-w-0 flex-1">
					<p className="truncate font-semibold text-sm">
						{project.title ?? "Untitled project"}
					</p>
					<p className="truncate text-muted-foreground text-xs">
						{template?.name ?? "Project"}
					</p>
				</div>
				<Link
					href={`/projects/${project.id}`}
					className="shrink-0 rounded-full bg-primary px-4 py-1.5 font-medium text-primary-foreground text-sm transition-transform duration-150 hover:bg-primary/90 active:scale-[0.97]"
				>
					Open
				</Link>
			</div>
		</div>
	);
}

export function ProjectsSection({
	projects,
	isError,
	onRetry,
}: {
	projects: ProjectSummary[];
	isError?: boolean;
	onRetry?: () => void;
}) {
	return (
		<section className="flex flex-col gap-5">
			<SectionHeader
				icon={ClapperboardIcon}
				title="Projects"
				from="var(--chart-1)"
				to="var(--chart-2)"
			/>
			{isError ? (
				<ErrorStateCard
					title="Couldn't load projects"
					hint="Something went wrong while fetching your projects."
					onRetry={onRetry}
				/>
			) : projects.length > 0 ? (
				<ShowMore peek={552}>
					<div className="grid gap-4 sm:grid-cols-2">
						{projects.map((project) => (
							<ProjectMediaCard key={project.id} project={project} />
						))}
					</div>
				</ShowMore>
			) : (
				<EmptyStateCard
					icon={FolderIcon}
					title="No projects yet"
					hint="Describe your scene above or pick a template to start your first episode."
				/>
			)}
		</section>
	);
}

/* -------------------------------------------------------------------------- */
/* Assets                                                                     */
/* -------------------------------------------------------------------------- */

const ASSET_KIND_ICON: Record<string, LucideIcon> = {
	[AssetKind.CHARACTER_SHEET]: ImageIcon,
	[AssetKind.LOCATION_SHEET]: ImageIcon,
	[AssetKind.KEYFRAME]: ImageIcon,
	[AssetKind.SCENE_VIDEO]: ClapperboardIcon,
	[AssetKind.RENDER]: ClapperboardIcon,
};

// Image kinds only — scene videos and renders are mp4s, which an <img>
// can't paint (broken-image glyph). Those tiles show their kind icon.
const VISUAL_ASSET_KINDS: string[] = [
	AssetKind.CHARACTER_SHEET,
	AssetKind.LOCATION_SHEET,
	AssetKind.KEYFRAME,
];

type ProjectAsset = ProjectDetail["assets"][number];

export function AssetTile({ asset }: { asset: ProjectAsset }) {
	const isVisual =
		VISUAL_ASSET_KINDS.includes(asset.kind) &&
		asset.status === AssetStatus.READY;
	const { data: signed } = useAssetUrl(isVisual ? asset.id : undefined);
	const Icon = ASSET_KIND_ICON[asset.kind] ?? ImageIcon;

	return (
		<div className="glass-edge relative aspect-square overflow-hidden rounded-xl bg-card/50">
			{signed?.url ? (
				// biome-ignore lint/performance/noImgElement: signed R2 URLs are short-lived and per-asset — next/image's remote-loader allowlist doesn't fit this.
				<img
					src={signed.url}
					alt={asset.kind}
					className="absolute inset-0 h-full w-full object-cover"
				/>
			) : (
				<div className="absolute inset-0 flex items-center justify-center">
					<Icon className="size-5 text-muted-foreground/60" />
				</div>
			)}
			<span className="absolute bottom-1.5 left-2 rounded-full bg-black/45 px-2 py-0.5 text-[10px] text-white/85 capitalize backdrop-blur-sm">
				{asset.kind.replace(/_/g, " ")}
			</span>
		</div>
	);
}

export function AssetsSection({
	detail,
	isError,
	onRetry,
}: {
	detail: ProjectDetail | undefined;
	isError?: boolean;
	onRetry?: () => void;
}) {
	const assets = detail?.assets ?? [];

	return (
		<section className="flex flex-col gap-5">
			<SectionHeader
				icon={SparklesIcon}
				title="Assets"
				from="var(--chart-3)"
				to="var(--chart-5)"
			/>
			{isError ? (
				<ErrorStateCard
					title="Couldn't load assets"
					hint="Something went wrong while fetching your latest assets."
					onRetry={onRetry}
				/>
			) : assets.length > 0 ? (
				// peek ≈ one tile row — extra rows frost under the veil.
				<ShowMore peek={176}>
					<div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
						{assets.map((asset) => (
							<AssetTile key={asset.id} asset={asset} />
						))}
					</div>
				</ShowMore>
			) : (
				<EmptyStateCard
					icon={SparklesIcon}
					title="No assets yet"
					hint="Character sheets, keyframes and clips will appear here as your first generation runs."
				/>
			)}
		</section>
	);
}

/* -------------------------------------------------------------------------- */
/* Create (template showcase — Higgsfield-style video cards)                  */
/* -------------------------------------------------------------------------- */

type SportTemplate = (typeof SPORT_TEMPLATES)[number];

function TemplateVideoCard({
	template,
	onGenerate,
}: {
	template: SportTemplate;
	onGenerate: (key: SportTemplate["key"]) => void;
}) {
	return (
		<div className="glass-edge flex flex-col gap-3 rounded-2xl bg-card/50 p-3">
			<div className="relative aspect-video overflow-hidden rounded-xl">
				{/* Still underneath; the showcase clip paints over it once it loads.
				    If the mp4 is missing/unsupported the video paints nothing and
				    the still simply shows through — graceful by construction. The
				    clip-only templates (no still shipped) rest on the card tone. */}
				{template.hasStill ? (
					<Image
						src={`/templates/${template.key}-v2.png`}
						alt={template.name}
						fill
						sizes="480px"
						className="object-cover"
					/>
				) : null}
				<video
					className="absolute inset-0 h-full w-full object-cover"
					src={`/templates/${template.key}.mp4`}
					autoPlay
					muted
					loop
					playsInline
					aria-hidden
					// Eight muted videos race autoplay on this page — nudge any
					// copy that mounted paused (no-op when autoplay won).
					onLoadedData={(event) => {
						event.currentTarget.play().catch(() => {});
					}}
				/>
				<div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.35),transparent_40%)]" />
			</div>
			<div className="flex items-center gap-3">
				<JewelIcon
					icon={template.icon}
					from={template.gradient.from}
					to={template.gradient.to}
					size={34}
				/>
				<div className="min-w-0 flex-1">
					<p className="truncate font-semibold text-sm">{template.name}</p>
					<p className="truncate text-muted-foreground text-xs">
						{template.examplePrompt}
					</p>
				</div>
				<button
					type="button"
					onClick={() => onGenerate(template.key)}
					className="shrink-0 rounded-full bg-primary px-4 py-1.5 font-medium text-primary-foreground text-sm transition-transform duration-150 hover:bg-primary/90 active:scale-[0.97]"
				>
					Generate
				</button>
			</div>
		</div>
	);
}

export function ShowcaseSection({
	onGenerate,
}: {
	onGenerate: (key: SportTemplate["key"]) => void;
}) {
	return (
		<section className="flex flex-col gap-5">
			<SectionHeader
				icon={ClapperboardIcon}
				title="Create"
				from="var(--chart-5)"
				to="var(--chart-2)"
			/>
			{/* peek ≈ one full card row (~360px + gap) + a half-cut slice of
			    the next — the Higgsfield look. */}
			<ShowMore peek={552} moreCount={SPORT_TEMPLATES.length - 2}>
				<div className="grid gap-4 sm:grid-cols-2">
					{SPORT_TEMPLATES.map((template) => (
						<TemplateVideoCard
							key={template.key}
							template={template}
							onGenerate={onGenerate}
						/>
					))}
				</div>
			</ShowMore>
		</section>
	);
}
