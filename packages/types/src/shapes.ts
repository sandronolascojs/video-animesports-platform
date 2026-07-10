import type {
	CameraAngle,
	CameraMotion,
	CharacterGender,
	Pacing,
	ShotScale,
} from "./enums";

export type TimelineEntry = {
	sceneId: string;
	videoAssetId: string;
	durationSeconds: number;
};

export type SubtitleStyle = {
	font?: string;
	fontSize?: number;
	weight?: string;
	color?: string;
	outlineColor?: string;
	backgroundColor?: string;
	position?: string;
};

export type ProjectPlanCharacter = {
	name: string;
	role: string;
	visualDescription: string;
	gender?: CharacterGender;
	sheetAssetId: string | null;
};

export type ProjectPlanLocation = {
	key: string;
	name: string;
	description: string;
	timeOfDay: string;
	sheetAssetId: string | null;
};

export type StyleBibleSpec = {
	/** Era/studio-look sentence, e.g. "late-2000s Shonen sports anime...". */
	artDirection: string;
	/** Line weight + ink rules (keyline thickness, cleanup style). */
	lineArt: string;
	/** Master palette + how color behaves across kits/skin/sky/night-day. */
	colorScript: string;
	/** Proportions, eyes, hair, shading rules — the character rendering model. */
	characterRendering: string;
	/** Key/rim/ambient lighting rules, per time-of-day. */
	lighting: string;
	/** Lens language + framing habits characteristic of this show. */
	cameraGrammar: string;
	/** Grain/bloom/post-processing texture. */
	filmTexture: string;
	/** Anime timing rules: impact frames, speed lines, smears, held frames. */
	motionLanguage: string;
};

export type ProjectPlanKeyframe = {
	/** Precise visual composition of this frozen frame: who, where, pose, framing. */
	description: string;
	charactersPresent: string[];
	locationKey: string;
	shotScale: ShotScale;
	cameraAngle: CameraAngle;
};

export type ProjectPlanCinematography = {
	cameraMotion: CameraMotion;
	/** Anime-timing description of the action beats (impacts, holds, smears). */
	motionNotes: string;
	pacing: Pacing;
};

export type ProjectPlanSceneMeta = {
	sceneId: string;
	characterNames: string[];
	locationKey: string;
	cinematography: ProjectPlanCinematography;
};

export type ProjectPlan = {
	styleBibleSpec: StyleBibleSpec;
	characters: ProjectPlanCharacter[];
	locations: ProjectPlanLocation[];
	scenes: ProjectPlanSceneMeta[];
	/** The keyframe chain, K1..KN+1 in order — see `ProjectPlanKeyframe`. */
	keyframes: ProjectPlanKeyframe[];
};

// assets.metadata — kind-specific extras (width/height for images & video,
// duration for video/audio). Kept as a flat, non-recursive, concretely
// typed shape rather than a free-form JSON bag: Cloudflare Workflows'
// `Rpc.Serializable<T>` constraint (checked on every `step.do` return value)
// cannot prove an `unknown`/`Record<string, unknown>`-typed field is
// serializable — that breaks every workflow step returning a row with such
// a field. Grow this explicitly if a new kind needs new metadata.
export type AssetMetadata = {
	width?: number;
	height?: number;
	durationSeconds?: number;
};
