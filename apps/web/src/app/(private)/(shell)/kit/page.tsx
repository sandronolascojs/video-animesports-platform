"use client";

import { Clapperboard, Film, Images, Sparkles } from "lucide-react";
import { useState } from "react";
import {
	ActionButton,
	AIDock,
	AIDockInput,
	JewelIcon,
	TemplateCard,
	TemplateCardFan,
} from "@/components/app";
import { SubtitleLanguageSelector } from "@/components/app/selectors/subtitle-language-selector";
import { VoiceLanguageSelector } from "@/components/app/selectors/voice-language-selector";
import { PixelField } from "@/components/effects/pixel-field";
import { AspectRatioSelector } from "@/feature/home/components/aspect-ratio-selector";
import { usePlatform } from "@/hooks/use-platform";

// Dev-only preview page — inlined instead of importing from the deleted
// mock module (kit page keeps static demo props, cheapest fix per
// front-wiring phase 1 scope).
type AspectRatio = "16:9" | "9:16";

const HERO_PLACEHOLDERS = [
	"Describe your sports anime…",
	"A soccer match under stadium lights…",
	"Basketball finals, buzzer-beater shot…",
];

const FLOATING_PLACEHOLDERS = [
	"Ask the agent to edit this project…",
	"Swap scenes 2 and 4…",
	"Make scene 5 shorter, like 5 seconds…",
];

const JEWEL_SAMPLES = [
	{ icon: Sparkles, from: "var(--chart-1)", to: "var(--chart-2)" },
	{ icon: Film, from: "var(--chart-2)", to: "var(--chart-4)" },
	{ icon: Clapperboard, from: "var(--chart-3)", to: "var(--chart-5)" },
	{ icon: Images, from: "var(--chart-4)", to: "var(--chart-1)" },
] as const;

const FAN_TEMPLATES = [
	{
		title: "Soccer",
		prompt: "A last-minute winning goal, crowd roaring.",
		from: "var(--chart-1)",
		to: "var(--chart-2)",
	},
	{
		title: "Basketball",
		prompt: "Buzzer-beater three-pointer at the finals.",
		from: "var(--chart-2)",
		to: "var(--chart-3)",
	},
	{
		title: "Baseball",
		prompt: "Walk-off home run under the floodlights.",
		from: "var(--chart-3)",
		to: "var(--chart-4)",
	},
	{
		title: "Tennis",
		prompt: "Match point rally on center court.",
		from: "var(--chart-4)",
		to: "var(--chart-5)",
	},
] as const;

/**
 * Dev-only preview of the v1 studio-ui component kit — not part of the
 * product surface. Phase B may delete this page once the real Home/Studio
 * views land and exercise these components directly.
 */
export default function KitPreviewPage() {
	const { modLabel } = usePlatform();
	const [selected, setSelected] = useState<number | null>(null);
	const [heroValue, setHeroValue] = useState("");
	const [dockValue, setDockValue] = useState("");
	const [isWorking, setIsWorking] = useState(false);
	const [hasMessages, setHasMessages] = useState(false);
	const [taskName, setTaskName] = useState<string | undefined>(undefined);
	const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
	const [voiceLanguage, setVoiceLanguage] = useState<"ja" | "en">("ja");
	const [subtitleLanguage, setSubtitleLanguage] = useState<"en" | "ja">("en");

	const simulateTask = () => {
		setHasMessages(true);
		setTaskName("Regenerating scene 3");
		setIsWorking(true);
		setTimeout(() => {
			setIsWorking(false);
			setTimeout(() => setTaskName(undefined), 2000);
		}, 2600);
	};

	return (
		<div className="flex flex-col gap-12 p-8 pb-40">
			<div className="rounded-xl border border-amber-500/40 border-dashed bg-amber-500/10 px-4 py-2 text-amber-600 text-sm dark:text-amber-400">
				Dev-only kit preview — phase A component gallery, not a real view.
			</div>

			<section className="flex flex-col gap-4">
				<h2 className="font-semibold text-lg">PixelField</h2>
				<div className="relative h-64 overflow-hidden rounded-2xl border border-border/60">
					<PixelField className="absolute inset-0" seed="kit" />
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="font-semibold text-lg">JewelIcon</h2>
				<div className="flex items-center gap-4">
					{JEWEL_SAMPLES.map(({ icon, from, to }) => (
						<JewelIcon key={`${from}-${to}`} icon={icon} from={from} to={to} />
					))}
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="font-semibold text-lg">TemplateCardFan</h2>
				<TemplateCardFan>
					{FAN_TEMPLATES.map((template, index) => (
						<TemplateCard
							key={template.title}
							title={template.title}
							prompt={template.prompt}
							from={template.from}
							to={template.to}
							selected={selected === index}
							onSelect={() => setSelected(index)}
						/>
					))}
				</TemplateCardFan>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="font-semibold text-lg">
					Selectors — Home composer (HOME ONLY, per docs/studio-ui.md)
				</h2>
				<div className="flex items-center gap-0.5 rounded-xl border border-border/60 p-2">
					<AspectRatioSelector value={aspectRatio} onChange={setAspectRatio} />
					<VoiceLanguageSelector
						value={voiceLanguage}
						onChange={setVoiceLanguage}
					/>
					<SubtitleLanguageSelector
						value={subtitleLanguage}
						onChange={setSubtitleLanguage}
					/>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="font-semibold text-lg">ActionButton</h2>
				<div className="flex items-center gap-3">
					<ActionButton active aria-label="Active action">
						<Sparkles className="size-4" />
					</ActionButton>
					<ActionButton aria-label="Inactive action">
						<Sparkles className="size-4" />
					</ActionButton>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="font-semibold text-lg">
					AIDockInput — hero mode (Home)
				</h2>
				<div className="hero-dots relative flex justify-center rounded-2xl border border-border/60 p-12">
					<div className="w-full max-w-2xl">
						<AIDockInput
							mode="hero"
							value={heroValue}
							onChange={setHeroValue}
							onSubmit={() => setHeroValue("")}
							placeholders={HERO_PLACEHOLDERS}
						/>
					</div>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="font-semibold text-lg">
					AIDock — floating mode (Studio)
				</h2>
				<p className="text-muted-foreground text-sm">
					Fixed to the bottom of the viewport. Click the pill (or press{" "}
					{modLabel}K) to expand, or{" "}
					<button
						type="button"
						onClick={simulateTask}
						className="underline underline-offset-2"
					>
						simulate a task
					</button>{" "}
					to preview the status bar / working / complete states.
				</p>
			</section>

			<AIDock
				value={dockValue}
				onChange={setDockValue}
				onSubmit={() => setDockValue("")}
				placeholders={FLOATING_PLACEHOLDERS}
				taskName={taskName}
				isWorking={isWorking}
				hasMessages={hasMessages}
			/>
		</div>
	);
}
