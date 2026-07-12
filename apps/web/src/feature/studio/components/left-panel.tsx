"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssetsPanel } from "@/feature/studio/components/assets-panel";
import { ScenesPanel } from "@/feature/studio/components/scenes-panel";
import { SubtitlesPanel } from "@/feature/studio/components/subtitles-panel";

/**
 * Assets & Scenes panel (docs/studio-ui.md §1 diagram, left column): shadcn
 * Tabs switching between Scenes / Assets / Subtitles. The v1 mock also had a
 * "Cast" tab (characters/locations) — dropped in front-wiring phase 1: the
 * v2 API has no characters/locations table (packages/types/src/shapes.ts
 * `ProjectPlan` — that data lives in a `projects.plan` jsonb column the
 * contract doesn't even expose to the client), so there's nothing to wire it
 * to. Revisit if/when the contract surfaces the plan's cast.
 */
export function LeftPanel() {
	return (
		<Tabs
			defaultValue="scenes"
			className="surface-panel h-full min-h-0 gap-0 p-3"
		>
			<TabsList className="w-full">
				<TabsTrigger value="scenes">Scenes</TabsTrigger>
				<TabsTrigger value="assets">Assets</TabsTrigger>
				<TabsTrigger value="subtitles">Subtitles</TabsTrigger>
			</TabsList>
			<TabsContent value="scenes" className="min-h-0 flex-1 pt-3">
				<ScenesPanel />
			</TabsContent>
			<TabsContent value="assets" className="min-h-0 flex-1 pt-3">
				<AssetsPanel />
			</TabsContent>
			<TabsContent value="subtitles" className="min-h-0 flex-1 pt-3">
				<SubtitlesPanel />
			</TabsContent>
		</Tabs>
	);
}
