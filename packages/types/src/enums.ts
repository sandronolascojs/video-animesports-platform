export const AudioLanguage = {
	JAPANESE: "ja",
	ENGLISH: "en",
} as const;

export type AudioLanguage = (typeof AudioLanguage)[keyof typeof AudioLanguage];

export const SubtitleLanguage = {
	ENGLISH: "en",
	JAPANESE: "ja",
} as const;

export type SubtitleLanguage =
	(typeof SubtitleLanguage)[keyof typeof SubtitleLanguage];

export const ProjectStatus = {
	DRAFT: "draft",
	PLANNING: "planning",
	STORYBOARD: "storyboard",
	GENERATING: "generating",
	ASSEMBLING: "assembling",
	READY: "ready",
	FAILED: "failed",
} as const;

export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export const SceneStatus = {
	PLANNED: "planned",
	KEYFRAME_PENDING: "keyframe_pending",
	KEYFRAME_READY: "keyframe_ready",
	VIDEO_PENDING: "video_pending",
	VIDEO_READY: "video_ready",
	FAILED: "failed",
} as const;

export type SceneStatus = (typeof SceneStatus)[keyof typeof SceneStatus];

export const AssetKind = {
	CHARACTER_SHEET: "character_sheet",
	LOCATION_SHEET: "location_sheet",
	KEYFRAME: "keyframe",
	SCENE_VIDEO: "scene_video",
	SCENE_AUDIO: "scene_audio",
	RENDER: "render",
} as const;

export type AssetKind = (typeof AssetKind)[keyof typeof AssetKind];

export const AssetStatus = {
	PENDING: "pending",
	READY: "ready",
	FAILED: "failed",
} as const;

export type AssetStatus = (typeof AssetStatus)[keyof typeof AssetStatus];

export const VersionStatus = {
	RENDERING: "rendering",
	READY: "ready",
	FAILED: "failed",
} as const;

export type VersionStatus = (typeof VersionStatus)[keyof typeof VersionStatus];

export const AspectRatio = {
	LANDSCAPE: "16:9",
	PORTRAIT: "9:16",
} as const;

export type AspectRatio = (typeof AspectRatio)[keyof typeof AspectRatio];

export const TemplateKey = {
	SOCCER: "soccer",
	BASKETBALL: "basketball",
	BASEBALL: "baseball",
	TENNIS: "tennis",
	HOCKEY: "hockey",
	VOLLEYBALL: "volleyball",
	BOXING: "boxing",
	TRACK: "track",
} as const;

export type TemplateKey = (typeof TemplateKey)[keyof typeof TemplateKey];

// Voice-casting axis for the plan agent's characters (docs §5b voice
// pipeline): drives which ElevenLabs pool a character's fixed voice is
// drawn from. Deliberately binary — it mirrors the premade voice catalog's
// own labeling, not a statement about the story's characters.
export const CharacterGender = {
	MALE: "male",
	FEMALE: "female",
} as const;

export type CharacterGender =
	(typeof CharacterGender)[keyof typeof CharacterGender];

export const GenerationTaskKind = {
	SHEET: "sheet",
	KEYFRAME: "keyframe",
	VIDEO: "video",
	SPEECH: "speech",
} as const;

export type GenerationTaskKind =
	(typeof GenerationTaskKind)[keyof typeof GenerationTaskKind];

export const GenerationTaskStatus = {
	PENDING: "pending",
	SUCCESS: "success",
	FAILED: "failed",
} as const;

export type GenerationTaskStatus =
	(typeof GenerationTaskStatus)[keyof typeof GenerationTaskStatus];

export const WorkflowMode = {
	PROJECT_GENERATION: "project-generation",
	SCENE_EXTENSION: "scene-extension",
	SCENE_RETRY: "scene-retry",
} as const;

export type WorkflowMode = (typeof WorkflowMode)[keyof typeof WorkflowMode];

export const ShotScale = {
	EXTREME_WIDE: "extreme-wide",
	WIDE: "wide",
	MEDIUM: "medium",
	CLOSE_UP: "close-up",
	EXTREME_CLOSE_UP: "extreme-close-up",
} as const;

export type ShotScale = (typeof ShotScale)[keyof typeof ShotScale];

export const CameraAngle = {
	EYE_LEVEL: "eye-level",
	LOW_ANGLE: "low-angle",
	HIGH_ANGLE: "high-angle",
	DUTCH: "dutch",
	OVER_THE_SHOULDER: "over-the-shoulder",
} as const;

export type CameraAngle = (typeof CameraAngle)[keyof typeof CameraAngle];

export const CameraMotion = {
	STATIC: "static",
	PAN_LEFT: "pan-left",
	PAN_RIGHT: "pan-right",
	PUSH_IN: "push-in",
	PULL_BACK: "pull-back",
	TRACKING: "tracking",
	CRANE_UP: "crane-up",
	HANDHELD: "handheld",
} as const;

export type CameraMotion = (typeof CameraMotion)[keyof typeof CameraMotion];

export const Pacing = {
	SLOW_BURN: "slow-burn",
	BUILDING: "building",
	FRANTIC: "frantic",
} as const;

export type Pacing = (typeof Pacing)[keyof typeof Pacing];
