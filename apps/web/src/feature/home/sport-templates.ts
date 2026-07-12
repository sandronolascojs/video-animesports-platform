import {
	Baseball,
	Basketball,
	BoxingGlove,
	Hockey,
	PersonSimpleRun,
	SoccerBall,
	TennisBall,
	Volleyball,
} from "@phosphor-icons/react";
import { TemplateKey } from "@video-platform-challenge/types";
import type { ElementType } from "react";

/**
 * Home's template cards (docs/studio-ui.md "Template cards"): one per sport,
 * matching `packages/types` `TemplateKey` exactly so `template.key` can be
 * sent straight through as `createProjectInputSchema.templateKey`. Icon +
 * gradient + example prompt are presentational-only concerns with no
 * server-side equivalent (`packages/types/src/templates.ts`'s `TEMPLATES`
 * carries the agent-facing `styleBibleSeed`/`agentInstructions` instead) —
 * this is real frontend config, not mock data, so it lives here rather than
 * in the deleted `libs/mock`.
 *
 * Icons come from Phosphor (@phosphor-icons/react) — its catalog has REAL
 * sport glyphs (soccer ball, boxing glove, hockey sticks…) where lucide only
 * offered abstract stand-ins. `icon` is a plain `ElementType` so lucide and
 * Phosphor components both fit (`JewelIcon` renders them identically).
 */
export type SportTemplate = {
	key: TemplateKey;
	name: string;
	examplePrompt: string;
	gradient: { from: string; to: string };
	icon: ElementType;
	/** The first four templates shipped with card stills (`/templates/{key}-v2.png`); later ones are clip-only. */
	hasStill: boolean;
};

export const SPORT_TEMPLATES: SportTemplate[] = [
	{
		examplePrompt: "A last-minute winning goal, crowd roaring in the rain.",
		gradient: { from: "var(--chart-1)", to: "var(--chart-2)" },
		hasStill: true,
		icon: SoccerBall,
		key: TemplateKey.SOCCER,
		name: "Soccer",
	},
	{
		examplePrompt: "Buzzer-beater three-pointer at the finals, bench erupting.",
		gradient: { from: "var(--chart-2)", to: "var(--chart-4)" },
		hasStill: true,
		icon: Basketball,
		key: TemplateKey.BASKETBALL,
		name: "Basketball",
	},
	{
		examplePrompt:
			"Walk-off home run under the floodlights, dugout empties out.",
		gradient: { from: "var(--chart-3)", to: "var(--chart-5)" },
		hasStill: true,
		icon: Baseball,
		key: TemplateKey.BASEBALL,
		name: "Baseball",
	},
	{
		examplePrompt:
			"Match point rally on center court, crowd holding its breath.",
		gradient: { from: "var(--chart-4)", to: "var(--chart-1)" },
		hasStill: true,
		icon: TennisBall,
		key: TemplateKey.TENNIS,
		name: "Tennis",
	},
	{
		examplePrompt: "Overtime breakaway under the arena lights, ice spraying.",
		gradient: { from: "var(--chart-2)", to: "var(--chart-3)" },
		hasStill: false,
		icon: Hockey,
		key: TemplateKey.HOCKEY,
		name: "Hockey",
	},
	{
		examplePrompt: "Match-point spike over a triple block, gym erupting.",
		gradient: { from: "var(--chart-5)", to: "var(--chart-4)" },
		hasStill: false,
		icon: Volleyball,
		key: TemplateKey.VOLLEYBALL,
		name: "Volleyball",
	},
	{
		examplePrompt:
			"Last-round cross counter under the ring lights, crowd on its feet.",
		gradient: { from: "var(--chart-1)", to: "var(--chart-5)" },
		hasStill: false,
		icon: BoxingGlove,
		key: TemplateKey.BOXING,
		name: "Boxing",
	},
	{
		examplePrompt: "Photo-finish lean at the line, floodlights streaking past.",
		gradient: { from: "var(--chart-3)", to: "var(--chart-2)" },
		hasStill: false,
		icon: PersonSimpleRun,
		key: TemplateKey.TRACK,
		name: "Track",
	},
];
