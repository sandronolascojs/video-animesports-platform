// Story-so-far fixture for the extend-agent eval (phase AI-6b). Shaped
// EXACTLY like what apps/server/src/services/generation.service.ts's
// `runExtensionPlanStep` feeds `generateSceneExtension` (which is what
// `runExtendAgent` receives):
//   - `storySoFar`: prior scenes' {title, prompt, dialogue}, timeline order
//   - `previousKeyframeDescription`: the CURRENT last keyframe (K4 here —
//     3 scenes ⇒ K1..K4), the new scene's implicit start anchor
//   - `previousSceneCinematography`: the LAST scene's {cameraMotion,
//     motionNotes, pacing} from the plan (AI-6a §8d context upgrade)
//   - `synopsis` + `styleBible`: the compiled style block, produced by the
//     REAL `compileStyleBible` over a fully-specced StyleBibleSpec — same
//     text shape `projects.styleBible` persists in production
//   - `existingCharacterNames` / `existingLocationKeys` from the plan
//
// The story is built so BOTH eval cases have real narrative hooks: a drawn
// cup final (a rematch is plausible) and a dubious penalty call (a referee
// who "suspects the bribe" is plausible). Kaito is the named protagonist —
// case 2 introduces "Sofia, Kaito's older sister".
import type { StyleBibleSpec } from "@video-platform-challenge/types";
import {
	AudioLanguage,
	CameraMotion,
	Pacing,
	SubtitleLanguage,
	TemplateKey,
} from "@video-platform-challenge/types";
import { compileStyleBible } from "../../src/prompts/style-bible";

const STYLE_BIBLE_SPEC: StyleBibleSpec = {
	artDirection:
		"Modern 2020s high-budget soccer anime in the register of Blue Lock and Ao Ashi: razor-clean digital lineart with confident tapering strokes, crisp two-tone cel shading with hard shadow shapes, detailed expressive eyes with layered iris highlights, athletic anatomy drawn with real weight and torque. A night cup final drenched in floodlight glare, wet-look pitch reflections doubling every kit color.",
	lineArt:
		"Thick 3px outer silhouette keylines, 1px interior linework, sharp tapered stroke ends on hair and kit folds; cleanup is digital-crisp with zero sketch residue.",
	colorScript:
		"Azure-and-white home kits against charcoal-and-crimson away kits; pitch reads cool gray-green under floodlights with cyan-tinted shadows; night sky is deep indigo, ad boards emit muted magenta and white; skin tones stay warm against the cold palette.",
	characterRendering:
		"6.5-head athletic proportions, large angular eyes with two stacked iris highlights, hair in hard-edged clumps with single specular band, two-tone cel shading with one hard terminator and no soft gradients.",
	lighting:
		"Night match: hard white floodlight key from four stadium masts, cool cyan fill, hot rim light on shoulders and hair; close-ups get a single catchlight; rain adds specular streaks on kits and grass.",
	cameraGrammar:
		"Low dramatic angles on strikes and tackles, wide establishing shots from the stands between beats, over-the-shoulder framings for confrontations, lens-true shallow depth of field isolating faces on reaction beats.",
	filmTexture:
		"Subtle 16mm-style grain, restrained bloom on floodlights only, slight chromatic fringe at frame edges on peak-action shots; otherwise clean digital finish.",
	motionLanguage:
		"Impact frames with white flash on ball strikes, radial speed lines reserved for sprints and shots, 2-frame smears on whipping legs, held frames for one full second after decisive contact.",
};

/** One scene of context, exactly the `storySoFar` entry shape
 * (`{title, prompt, dialogue}`) `runExtensionPlanStep` builds. */
export interface StorySceneContext {
	title: string;
	prompt: string;
	dialogue: string;
}

export const STORY_SOFIA = {
	templateKey: TemplateKey.SOCCER,
	audioLanguage: AudioLanguage.ENGLISH,
	subtitleLanguage: SubtitleLanguage.ENGLISH,
	synopsis:
		"In the prefectural cup final, striker Kaito Tsukino faces his old rival, captain Ren Kurobane. When the referee awards Ren's side a penalty nobody else saw, whispers spread that the whistle was bought. Kaito answers the only way he can — a last-breath equalizer in stoppage time that forces the final to a replay and leaves the question of the crooked call hanging over both teams.",
	styleBible: compileStyleBible(STYLE_BIBLE_SPEC),
	// The full character bible (production keeps this in `projects.plan`;
	// the extend agent itself only receives the NAMES below, exactly like
	// runExtensionPlanStep). Kept here for judge-material realism.
	characters: [
		{
			name: "Kaito Tsukino",
			role: "protagonist striker, number 9 of Aozora United",
			gender: "male",
			visualDescription:
				"17-year-old striker, 175cm lean-muscled build. Navy-blue spiky hair swept back with one loose fringe strand over his right eye, sharp amber eyes with layered gold iris highlights, light warm skin tone. Azure-and-white Aozora United kit, number 9 in white block digits, white boots with azure heel flashes. Distinguishing marks: thin white scar through his left eyebrow, black wrist tape on his right wrist.",
		},
		{
			name: "Ren Kurobane",
			role: "rival captain and playmaker, number 10 of Kurogane FC",
			gender: "male",
			visualDescription:
				"18-year-old playmaker, 180cm with broad shoulders. Jet-black shoulder-length hair tied in a short low ponytail, cold gray eyes with a single flat highlight, pale skin tone. Charcoal-and-crimson Kurogane FC kit with the captain's crimson armband on his left arm, number 10 in crimson digits, black boots. Distinguishing marks: silver stud in his left ear, permanent half-smirk resting expression.",
		},
	],
	existingCharacterNames: ["Kaito Tsukino", "Ren Kurobane"],
	existingLocationKeys: ["seiran_stadium_pitch"],
	storySoFar: [
		{
			title: "Final Under Floodlights",
			prompt:
				"Night cup final at Seiran Stadium. Wide establishing shot pushes slowly from the packed stands down toward the center circle, where Kaito Tsukino and Ren Kurobane face each other at kickoff, studs pawing the wet-look grass, floodlights burning halos into the indigo sky. The scoreboard reads 0-0, FINAL.",
			dialogue: "Three years, Ren. Tonight I take it back.",
		},
		{
			title: "The Bought Whistle",
			prompt:
				"Inside Aozora's box, Ren Kurobane goes down under a shoulder-to-shoulder challenge that barely grazes him. The referee, alone against the protest, points to the spot without hesitation. Low angle on Kaito frozen mid-stride, disbelief hardening into suspicion as Kurogane FC convert the penalty. Scoreboard ticks to 0-1.",
			dialogue: "Nobody touched him... who owns that whistle?",
		},
		{
			title: "Equalizer at the Death",
			prompt:
				"90+3 on the clock. Kaito receives on the edge of the box, cuts inside past two charcoal shirts, and rips a first-time strike into the top corner — impact frame, white flash, the net snapping taut. He wheels away to the corner flag as the final whistle blows on 1-1: the cup final is going to a replay.",
			dialogue: "This isn't over — not the match, not that call!",
		},
	] satisfies StorySceneContext[],
	/** K4 — the current last keyframe, the new scene's implicit START anchor. */
	previousKeyframeDescription:
		"Frozen instant at the corner flag of Seiran Stadium's rain-slick pitch: Kaito Tsukino on both knees mid-slide, fists clenched and raised, mouth open in a roar, azure kit mud-streaked; ten meters behind him Ren Kurobane stands motionless, gray eyes locked on Kaito, crimson armband catching the floodlight rim; the scoreboard glows 1-1 in the upper background. Wide shot, low angle.",
	/** Scene 3's cinematography — the exact {cameraMotion, motionNotes,
	 * pacing} shape `runExtensionPlanStep` pulls from the plan. */
	previousSceneCinematography: {
		cameraMotion: CameraMotion.TRACKING,
		motionNotes:
			"Tracking run onto the ball, 2-frame smear on the strike, white impact flash and a one-second held frame as the net snaps, then a whip-pan following the knee-slide to the corner flag.",
		pacing: Pacing.FRANTIC,
	},
} as const;
