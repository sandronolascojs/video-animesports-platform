import { TemplateKey } from "./enums";

// Per-template agent guidance for the plan/extendStory steps (docs §6, §8:
// "Templates as code, not tables (MVP)"). Kept intentionally small — style
// bible seed + agent instructions only. A DB-backed template system with
// example prompts is out of scope until templates become user-editable
// (docs §11 phase 7+).
//
// `styleBibleSeed` (architecture/v2-prompt-craft) is a SEED, not the final
// style bible: the plan agent's system prompt (apps/server's plan.service.ts)
// instructs the LLM to expand it into the full `StyleBibleSpec` (art
// direction, line art, color script, character rendering, lighting, camera
// grammar, film texture, motion language). Each seed below names concrete,
// recognizable anime-genre signifiers (a specific studio-era look, not just
// "anime style") so the expansion has real texture to build from instead of
// generic adjectives.
export type Template = {
	key: TemplateKey;
	name: string;
	styleBibleSeed: string;
	agentInstructions: string;
};

export const TEMPLATES: Record<TemplateKey, Template> = {
	[TemplateKey.SOCCER]: {
		key: TemplateKey.SOCCER,
		name: "Sports Anime — Soccer",
		styleBibleSeed:
			"Modern 2020s high-budget soccer anime in the register of Blue Lock and Ao Ashi: razor-clean digital lineart with confident tapering strokes, crisp two-tone cel shading with hard shadow shapes, detailed expressive eyes with layered iris highlights, athletic anatomy drawn with real weight and torque. Saturated but controlled palette — deep club-kit blues against cool gray-green pitch tones — cinematic rim light and lens-true depth of field on wide shots, sharp speed-line bursts and smear frames reserved for peak action.",
		agentInstructions:
			"Write a self-contained soccer episode built around a single match moment — a penalty, a last-minute strike, a duel between rivals. Establish the stakes (the score, the clock, what the protagonist stands to lose), raise tension toward that moment, and resolve on ONE decisive play and its emotional release — spread this arc across the scenes per the beat-structure guidance given separately. Name any characters the user's premise didn't already name (Japanese names fit the genre) — never rename, replace, or invent a substitute for a character the user specifically named. Give the protagonist a clear want and a visible obstacle, and write dialogue the way TV anime does: short, declarative, charged.",
	},
	[TemplateKey.BASKETBALL]: {
		key: TemplateKey.BASKETBALL,
		name: "Sports Anime — Basketball",
		styleBibleSeed:
			"Modern 2020s high-budget basketball anime in the register of Blue Lock-grade production: razor-clean digital lineart, crisp two-tone cel shading with hard shadow shapes, detailed expressive eyes, athletic anatomy with real weight in every jump and crossover. Controlled saturated palette — deep crimson kits against cool arena grays — volumetric spotlight beams through haze, glossy hardwood reflections painted with clean gradients, sharp motion smears only at peak plays.",
		agentInstructions:
			"Write a self-contained basketball episode built around one decisive play — a buzzer-beater, a block at the rim, a crossover that breaks the defense. Establish the stakes (the score, the clock, the matchup), raise tension toward it, and resolve on that ONE decisive play and its emotional release — spread this arc across the scenes per the beat-structure guidance given separately. Name any characters the user's premise didn't already name (Japanese names fit the genre) — never rename, replace, or invent a substitute for a character the user specifically named. Give the protagonist a clear want and a visible obstacle, and write dialogue the way TV anime does: short, declarative, charged.",
	},
	[TemplateKey.BASEBALL]: {
		key: TemplateKey.BASEBALL,
		name: "Sports Anime — Baseball",
		styleBibleSeed:
			"Modern 2020s high-budget baseball anime in the register of Blue Lock-grade production: razor-clean digital lineart, crisp two-tone cel shading with hard shadow shapes, detailed expressive eyes, athletic anatomy with real torque in every swing and pitch. Controlled palette — warm golden-hour ambers against deep infield shadow — cinematic backlit sun flare on the mound, dust kicked into volumetric light, tension close-ups with layered iris highlights before the decisive pitch.",
		agentInstructions:
			"Write a self-contained baseball episode built around one decisive pitch or swing — a full-count showdown, a walk-off, the last out. Establish the stakes (the inning, the count, what rides on this at-bat), raise tension toward it, and resolve on that ONE decisive pitch or swing and its emotional release — spread this arc across the scenes per the beat-structure guidance given separately. Name any characters the user's premise didn't already name (Japanese names fit the genre) — never rename, replace, or invent a substitute for a character the user specifically named. Give the protagonist a clear want and a visible obstacle, and write dialogue the way TV anime does: short, declarative, charged.",
	},
	[TemplateKey.TENNIS]: {
		key: TemplateKey.TENNIS,
		name: "Sports Anime — Tennis",
		styleBibleSeed:
			"Modern 2020s high-budget tennis anime in the register of Blue Lock-grade production: razor-clean digital lineart, crisp two-tone cel shading with hard shadow shapes, detailed expressive eyes, athletic anatomy stretched with real torque on serves and rallies. Controlled palette — sun-bleached court tones with sharp cool shadows — crisp geometric court-line perspective, whip-crack motion smears only at peak contact, lens-true bloom on match point.",
		agentInstructions:
			"Write a self-contained tennis episode built around one decisive point — an impossible return, an ace, a net-cord drop. Establish the stakes (the set score, match point, what losing means), raise tension toward it through the rally, and resolve on that ONE decisive point and its emotional release — spread this arc across the scenes per the beat-structure guidance given separately. Name any characters the user's premise didn't already name (Japanese names fit the genre) — never rename, replace, or invent a substitute for a character the user specifically named. Give the protagonist a clear want and a visible obstacle, and write dialogue the way TV anime does: short, declarative, charged.",
	},
	[TemplateKey.HOCKEY]: {
		key: TemplateKey.HOCKEY,
		name: "Sports Anime — Hockey",
		styleBibleSeed:
			"Modern 2020s high-budget ice hockey anime in the register of Blue Lock-grade production: razor-clean digital lineart, crisp two-tone cel shading with hard shadow shapes, detailed expressive eyes, athletic anatomy with real weight driving through every stride and check. Controlled palette — cool blue-white ice tones against deep crimson kits — arena spotlights flaring off the glass, ice spray kicked into rim light, sharp speed-line bursts reserved for breakaways and one-timers.",
		agentInstructions:
			"Write a self-contained hockey episode built around one decisive play — an overtime breakaway, a glove save, a one-timer at the horn. Establish the stakes (the score, the clock, the power play), raise tension toward it along the boards, and resolve on that ONE decisive play and its emotional release — spread this arc across the scenes per the beat-structure guidance given separately. Name any characters the user's premise didn't already name (Japanese names fit the genre) — never rename, replace, or invent a substitute for a character the user specifically named. Give the protagonist a clear want and a visible obstacle, and write dialogue the way TV anime does: short, declarative, charged.",
	},
	[TemplateKey.VOLLEYBALL]: {
		key: TemplateKey.VOLLEYBALL,
		name: "Sports Anime — Volleyball",
		styleBibleSeed:
			"Modern 2020s high-budget volleyball anime in the register of Blue Lock-grade production: razor-clean digital lineart, crisp two-tone cel shading with hard shadow shapes, detailed expressive eyes, athletic anatomy stretched with real torque at the apex of every jump. Controlled palette — warm hardwood tones against cool gym-shadow shapes — daylight flooding through high windows in volumetric beams, the ball frozen at the toss's peak, whip-crack motion smears only at the point of contact.",
		agentInstructions:
			"Write a self-contained volleyball episode built around one decisive play — a spike over a triple block, a match-saving dig, a setter dump. Establish the stakes (the set count, match point, who rotates to the front row), raise tension toward it through serve receive and rally, and resolve on that ONE decisive play and its emotional release — spread this arc across the scenes per the beat-structure guidance given separately. Name any characters the user's premise didn't already name (Japanese names fit the genre) — never rename, replace, or invent a substitute for a character the user specifically named. Give the protagonist a clear want and a visible obstacle, and write dialogue the way TV anime does: short, declarative, charged.",
	},
	[TemplateKey.BOXING]: {
		key: TemplateKey.BOXING,
		name: "Sports Anime — Boxing",
		styleBibleSeed:
			"Modern 2020s high-budget boxing anime in the register of Blue Lock-grade production: razor-clean digital lineart, crisp two-tone cel shading with hard shadow shapes, detailed expressive eyes, athletic anatomy with real weight behind every punch and slip. High-contrast palette — warm skin tones under the ring lights against a deep arena-shadow bokeh beyond the ropes — sweat scattering in the spotlight flash, one sharp smear frame reserved for the moment of impact.",
		agentInstructions:
			"Write a self-contained boxing episode built around one decisive moment — a cross counter, a last-round knockdown, beating the count. Establish the stakes (the round, the scorecards, what this title shot cost), raise tension toward it in the exchanges, and resolve on that ONE decisive moment and its emotional release — spread this arc across the scenes per the beat-structure guidance given separately. Name any characters the user's premise didn't already name (Japanese names fit the genre) — never rename, replace, or invent a substitute for a character the user specifically named. Give the protagonist a clear want and a visible obstacle, and write dialogue the way TV anime does: short, declarative, charged.",
	},
	[TemplateKey.TRACK]: {
		key: TemplateKey.TRACK,
		name: "Sports Anime — Track",
		styleBibleSeed:
			"Modern 2020s high-budget track-and-field anime in the register of Blue Lock-grade production: razor-clean digital lineart, crisp two-tone cel shading with hard shadow shapes, detailed expressive eyes, sprinting anatomy with real drive and torque through every stride. Controlled palette — cool night-meet tones with warm reflections off the track surface — stadium floodlights streaking past in long perspective, lane lines converging, speed lines reserved for the final lean at the tape.",
		agentInstructions:
			"Write a self-contained track episode built around one decisive moment — a photo-finish lean, a baton exchange under pressure, a personal best against a rival. Establish the stakes (the heat, the qualifying time, the anchor leg), raise tension toward it down the back straight, and resolve on that ONE decisive moment and its emotional release — spread this arc across the scenes per the beat-structure guidance given separately. Name any characters the user's premise didn't already name (Japanese names fit the genre) — never rename, replace, or invent a substitute for a character the user specifically named. Give the protagonist a clear want and a visible obstacle, and write dialogue the way TV anime does: short, declarative, charged.",
	},
};
