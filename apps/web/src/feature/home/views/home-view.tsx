"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
	type CreateProjectFormInput,
	type CreateProjectInput,
	createProjectInputSchema,
} from "@video-platform-challenge/api";
import {
	AudioLanguage,
	INITIAL_SCENE_COUNT,
	SubtitleLanguage,
	TemplateKey,
} from "@video-platform-challenge/types";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { AIDock, AIDockInput } from "@/components/app/ai-dock";
import { AppLogo } from "@/components/app/app-logo";
import { TemplateCard } from "@/components/app/template-card";
import { TemplateCardFan } from "@/components/app/template-card-fan";
import { DitherShader } from "@/components/ui/dither-shader";
import { WordRotate } from "@/components/ui/word-rotate";
import { FOCUS_COMPOSER_EVENT } from "@/constants/app.constants";
import { ComposerToolbar } from "@/feature/home/components/composer-toolbar";
import {
	AssetsSection,
	ProjectsSection,
	ShowcaseSection,
} from "@/feature/home/components/dashboard-sections";
import {
	useCreateProject,
	useProjectDetail,
	useProjects,
} from "@/feature/home/hooks/http/use-projects";
import { useTemplateGhost } from "@/feature/home/hooks/use-template-ghost";
import { SPORT_TEMPLATES } from "@/feature/home/sport-templates";

const HERO_PLACEHOLDERS = SPORT_TEMPLATES.map(
	(template) => template.examplePrompt,
);

/**
 * Higgsfield-style hero (docs/studio-ui.md Home): radial token gradient +
 * TRAE-style dithered pixel artwork (static `DitherShader`, CSS-only drift)
 * behind the greeting, hero composer (AIDockInput "hero" mode), fanned
 * template cards with hover-fills-input. Below the hero, "Recent projects"
 * renders the `apple-invites` carousel fed by `projects.list` — clicking
 * navigates to whichever card is currently centered (the carousel
 * auto-rotates; tracked via its controlled `activeIndex`/`onChange`, since
 * the vendored component has no per-card click prop to hang a `<Link>` off
 * of).
 *
 * The composer validates against the SHARED `createProjectInputSchema` from
 * `@video-platform-challenge/api` (app-wide "Forms rule" — never an inline
 * duplicate) — `watch`/`setValue` per field rather than `register`, since
 * `AIDockInput` and `ComposerToolbar`'s selectors are controlled
 * value/onChange components, not ref-registrable inputs.
 */
export function HomeView() {
	const router = useRouter();
	const createProject = useCreateProject();

	// Once the scroll commits past the hero, the SAME form re-surfaces as the
	// floating AIDock pinned to the bottom (Higgsfield behavior) —
	// identical state, identical submit, just a different shell. Gated on
	// scroll position (not an IntersectionObserver): on short viewports the
	// hero content overflows its section and observer ratios lie, which put
	// the dock on top of the hero composer.
	const [pastHero, setPastHero] = useState(false);

	// Three explicit generics (input, context, output): `sceneCount`'s zod
	// `.default()` splits the schema's input type (optional) from its output
	// (required number), and resolvers v5 types `zodResolver` with BOTH sides —
	// form state binds to `CreateProjectFormInput`, `handleSubmit` delivers the
	// parsed `CreateProjectInput`.
	const { watch, setValue, handleSubmit } = useForm<
		CreateProjectFormInput,
		unknown,
		CreateProjectInput
	>({
		defaultValues: {
			// Prefilled from the template default (docs/studio-ui.md: "anime →
			// Japanese voice") — every current sport template is anime, so a
			// static default covers v1; per-template overrides can land once
			// templates diverge.
			aspectRatio: "16:9",
			audioLanguage: AudioLanguage.JAPANESE,
			description: "",
			sceneCount: INITIAL_SCENE_COUNT,
			subtitleLanguage: SubtitleLanguage.ENGLISH,
			templateKey: TemplateKey.SOCCER,
		},
		resolver: zodResolver(createProjectInputSchema),
	});
	const description = watch("description");
	const aspectRatio = watch("aspectRatio");
	const audioLanguage = watch("audioLanguage");
	const subtitleLanguage = watch("subtitleLanguage");
	// `?? INITIAL_SCENE_COUNT` narrows the input-side optionality — the
	// defaultValues above guarantee a value at runtime.
	const sceneCount = watch("sceneCount") ?? INITIAL_SCENE_COUNT;

	const [focusSignal, setFocusSignal] = useState(0);
	const { hoveredKey, onHoverChange } = useTemplateGhost();

	const scrollRef = useRef<HTMLDivElement>(null);
	const heroRef = useRef<HTMLElement>(null);

	// Dashboard data: real projects + the latest project's assets preview.
	const {
		data: projects = [],
		isError: projectsError,
		refetch: refetchProjects,
	} = useProjects();
	const {
		data: latestDetail,
		isError: detailError,
		refetch: refetchDetail,
	} = useProjectDetail(projects[0]?.id);

	// Higgsfield's section jump (their page: html/body overflow hidden + a
	// custom wheel hijack — no CSS scroll-snap, verified in devtools): one
	// wheel gesture inside the hero commits to the sections, and back from
	// their top edge. Native fluid scrolling everywhere else. Two details
	// carry the "smooth" feel:
	//   1. easeInOutCubic over ~700ms — a soft launch and a silky landing
	//      (the previous easeOutQuint kicked off at max velocity, which read
	//      as a jolt).
	//   2. Trackpad momentum keeps emitting wheel events AFTER the jump
	//      lands; without swallowing that tail the page drifts past the
	//      section top. Momentum events arrive in a dense stream, so a
	//      >90ms gap between events marks a genuinely new gesture — the
	//      tail is eaten, a new flick scrolls normally.
	useEffect(() => {
		const el = scrollRef.current;
		const hero = heroRef.current;
		if (!el || !hero) {
			return;
		}

		let animating = false;
		let swallowMomentum = false;
		let lastWheelAt = 0;

		const animateTo = (target: number) => {
			animating = true;
			const start = el.scrollTop;
			const distance = target - start;
			const durationMs = 700;
			const startedAt = performance.now();
			const ease = (t: number) =>
				t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
			const step = (now: number) => {
				const t = Math.min((now - startedAt) / durationMs, 1);
				el.scrollTop = start + distance * ease(t);
				if (t < 1) {
					requestAnimationFrame(step);
				} else {
					animating = false;
					swallowMomentum = true;
				}
			};
			requestAnimationFrame(step);
		};

		const onWheel = (event: WheelEvent) => {
			const now = performance.now();
			const isNewGesture = now - lastWheelAt > 90;
			lastWheelAt = now;

			if (animating) {
				event.preventDefault();
				return;
			}
			if (swallowMomentum) {
				if (!isNewGesture) {
					event.preventDefault();
					return;
				}
				swallowMomentum = false;
			}

			const heroHeight = hero.offsetHeight;
			const top = el.scrollTop;
			if (event.deltaY > 0 && top < heroHeight - 8) {
				event.preventDefault();
				animateTo(heroHeight);
			} else if (event.deltaY < 0 && top > 0 && top <= heroHeight + 8) {
				event.preventDefault();
				animateTo(0);
			}
		};

		const onScroll = () => {
			setPastHero(el.scrollTop > hero.offsetHeight * 0.6);
		};
		onScroll();

		el.addEventListener("wheel", onWheel, { passive: false });
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			el.removeEventListener("wheel", onWheel);
			el.removeEventListener("scroll", onScroll);
		};
	}, []);

	// The sidebar "New project" pill's routing logic (docs/ai-architecture-v1.md
	// §1): on `/` it dispatches this event directly instead of opening the
	// create-project modal (Home owns its own hero composer) — bumping the
	// existing `focusSignal` state reuses the same imperative-focus mechanism
	// the template-card fan already drives.
	useEffect(() => {
		const onFocusComposer = () => setFocusSignal((count) => count + 1);
		window.addEventListener(FOCUS_COMPOSER_EVENT, onFocusComposer);
		return () =>
			window.removeEventListener(FOCUS_COMPOSER_EVENT, onFocusComposer);
	}, []);

	const useTemplateFromSection = (key: TemplateKey) => {
		commitTemplateValues(key);
		scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
	};

	const hoveredTemplate = SPORT_TEMPLATES.find(
		(template) => template.key === hoveredKey,
	);
	const ghostText =
		description.trim().length === 0
			? hoveredTemplate?.examplePrompt
			: undefined;

	// Shared by the hero fan (adds a focus bump) and the sections' Generate
	// pills (no focus — focusing an offscreen input would yank the smooth
	// scroll back to the top instantly). A click only loads the prompt into
	// the composer; it never marks the card selected (owner call).
	const commitTemplateValues = (key: TemplateKey) => {
		const template = SPORT_TEMPLATES.find((candidate) => candidate.key === key);
		if (!template) {
			return;
		}
		setValue("templateKey", key);
		if (description.trim().length === 0) {
			setValue("description", template.examplePrompt);
		}
	};

	const commitTemplate = (key: TemplateKey) => {
		commitTemplateValues(key);
		setFocusSignal((count) => count + 1);
	};

	const onSubmit = handleSubmit((values) => {
		// M3 fix: double-submit guard — a second Enter/click while the first
		// `projects.create` call is still in flight would fire two projects.
		// Mirrors `isChatWorking`'s gate on the Studio composers.
		if (createProject.isPending) {
			return;
		}
		createProject.mutate(values, {
			onSuccess: (summary) => {
				router.push(`/projects/${summary.id}`);
			},
		});
	});

	return (
		// Relative anchor for the floating AIDock (absolute) — the dock
		// centers within this CONTENT box, symmetric with the hero composer.
		<div className="relative h-[calc(100svh-1rem)]">
			<div ref={scrollRef} className="h-full overflow-y-auto bg-background">
				{/*
				 * `isolate` is load-bearing: without it the negative-z layers paint
				 * BEHIND the opaque ancestor backgrounds and the whole backdrop is
				 * invisible. `snap-always` makes one flick from the hero commit to
				 * the next section (the Higgsfield "jump").
				 */}
				<section
					ref={heroRef}
					className="relative isolate flex h-[calc(100svh-1rem)] flex-col items-center justify-center gap-10 px-6 py-16"
				>
					{/* The whole backdrop fades out toward the section bottom so the
				    snap into the next section melts into the shell tone — nothing
				    hard-edged survives the scroll (Higgsfield transition). */}
					<div
						aria-hidden
						className="absolute inset-0 -z-10 overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent_100%)]"
					>
						{/* Elevated hero tone (Higgsfield): the section starts on the
					    lighter sidebar/card gray; the container mask dissolves it —
					    together with the art — into the dark page bg below. THIS is
					    the color merge: one long vertical fade, never a seam. */}
						<div className="absolute inset-0 bg-sidebar" />
						{/*
						 * Anime key visual through the Bayer dither shader, rendered
						 * ONCE (`animated` stays false — its animation mode re-dithers
						 * every viewport pixel per frame on the CPU, which is what
						 * froze this page before). STATIC by design (no drift — user
						 * call) and masked to the edges: the art breathes around the
						 * content instead of filling the frame — minimal, not a mural.
						 */}
						<div className="absolute inset-0 opacity-55 [mask-image:radial-gradient(90%_80%_at_50%_42%,transparent_24%,black_70%)]">
							<DitherShader
								src="/dashboard-dither.png"
								gridSize={2}
								ditherMode="bayer"
								colorMode="duotone"
								primaryColor="#141414"
								secondaryColor="#8a8a8a"
								brightness={0.12}
								contrast={1.15}
								animated={false}
								objectFit="cover"
							/>
						</div>
						{/* RadialBackground recipe (user reference) OVER the artwork:
					    transparent center keeps the scene crisp, edges tint toward
					    the card tone so the art mixes into the shell — gradient
					    effect without washing anything white. */}
						<div className="absolute inset-0 [background:radial-gradient(125%_125%_at_50%_10%,transparent_35%,var(--card)_100%)]" />
						{/* Border ring that BELONGS to the hero (scrolls away with it):
					    crisp at the top, dissolved by the same merge gradient below —
					    never visible once the hero is gone. */}
						<div className="pointer-events-none absolute inset-0 rounded-2xl border border-sidebar-border [mask-image:linear-gradient(to_bottom,black_45%,transparent_85%)]" />
					</div>

					<div className="relative flex flex-col items-center gap-8">
						<AppLogo size={32} />

						{/* CTA headline (user call: same style as the old greeting,
						    normal case, ONE line, normal font color) — only the tail
						    rotates, reading as plain text that switches. One decisive
						    moment per sport template, so the words ARE the catalog. */}
						<h1 className="max-w-2xl text-center font-bold text-[1.75rem] tracking-tight">
							Create your next{" "}
							<WordRotate
								words={[
									"winning goal",
									"buzzer-beater",
									"walk-off",
									"match point",
									"breakaway",
									"spike",
									"knockout",
									"photo finish",
								]}
							/>
						</h1>

						<div className="w-full max-w-2xl">
							<AIDockInput
								mode="hero"
								value={description}
								onChange={(next) => setValue("description", next)}
								onSubmit={onSubmit}
								placeholders={HERO_PLACEHOLDERS}
								ghostText={ghostText}
								focusSignal={focusSignal}
								status={createProject.isPending ? "submitted" : undefined}
								leftToolbar={
									<ComposerToolbar
										aspectRatio={aspectRatio}
										onAspectRatioChange={(next) =>
											setValue("aspectRatio", next)
										}
										voiceLanguage={audioLanguage}
										onVoiceLanguageChange={(next) =>
											setValue("audioLanguage", next)
										}
										subtitleLanguage={subtitleLanguage}
										onSubtitleLanguageChange={(next) =>
											setValue("subtitleLanguage", next)
										}
										sceneCount={sceneCount}
										onSceneCountChange={(next) => setValue("sceneCount", next)}
									/>
								}
							/>
						</div>

						{/* Template picker — the classic 4-card fan (static positions,
					    old size), each card in the apple-card UI: artwork + frosted
					    glass bottom + composer glass border, lifting on hover.
					    Hover previews the prompt as ghost text; click commits.
					    FEATURED FOUR ONLY (user call): the fan layout is built for
					    four tilted slots — the full catalog lives in the Create
					    section's Show-more grid below. */}
						<TemplateCardFan>
							{SPORT_TEMPLATES.slice(0, 4).map((template) => (
								<TemplateCard
									key={template.key}
									title={template.name}
									prompt={template.examplePrompt}
									image={`/templates/${template.key}-v2.png`}
									from={template.gradient.from}
									to={template.gradient.to}
									onHoverChange={onHoverChange(template.key)}
									onSelect={() => commitTemplate(template.key)}
								/>
							))}
						</TemplateCardFan>
					</div>
				</section>

				{/* Dashboard sections (Higgsfield register): Create showcase with
				    the generated template clips, real Projects, Assets preview —
				    the wheel jump above lands right here. */}
				<div className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-8 pt-6 pb-32">
					<ShowcaseSection onGenerate={useTemplateFromSection} />
					<ProjectsSection
						projects={projects}
						isError={projectsError}
						onRetry={refetchProjects}
					/>
					<AssetsSection
						detail={latestDetail}
						isError={detailError}
						onRetry={refetchDetail}
					/>
				</div>
			</div>

			{/* Floating dock takes over once the scroll commits past the hero
			    (Higgsfield behavior) — same form state, same submit. */}
			{pastHero && (
				<AIDock
					value={description}
					onChange={(next) => setValue("description", next)}
					onSubmit={onSubmit}
					placeholders={HERO_PLACEHOLDERS}
					status={createProject.isPending ? "submitted" : undefined}
					leftToolbar={
						<ComposerToolbar
							aspectRatio={aspectRatio}
							onAspectRatioChange={(next) => setValue("aspectRatio", next)}
							voiceLanguage={audioLanguage}
							onVoiceLanguageChange={(next) => setValue("audioLanguage", next)}
							subtitleLanguage={subtitleLanguage}
							onSubtitleLanguageChange={(next) =>
								setValue("subtitleLanguage", next)
							}
							sceneCount={sceneCount}
							onSceneCountChange={(next) => setValue("sceneCount", next)}
						/>
					}
				/>
			)}
		</div>
	);
}
