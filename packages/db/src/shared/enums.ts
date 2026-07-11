import {
	AspectRatio,
	AssetKind,
	AssetStatus,
	AudioLanguage,
	GenerationTaskKind,
	GenerationTaskStatus,
	ProjectStatus,
	SceneStatus,
	SubtitleLanguage,
	TemplateKey,
	VersionStatus,
} from "@video-platform-challenge/types";
import { pgEnum } from "drizzle-orm/pg-core";

export const audioLanguageEnum = pgEnum("audio_language", [
	AudioLanguage.JAPANESE,
	AudioLanguage.ENGLISH,
]);

export const subtitleLanguageEnum = pgEnum("subtitle_language", [
	SubtitleLanguage.ENGLISH,
	SubtitleLanguage.JAPANESE,
]);

export const projectStatusEnum = pgEnum("project_status", [
	ProjectStatus.DRAFT,
	ProjectStatus.PLANNING,
	ProjectStatus.STORYBOARD,
	ProjectStatus.GENERATING,
	ProjectStatus.ASSEMBLING,
	ProjectStatus.READY,
	ProjectStatus.FAILED,
]);

export const sceneStatusEnum = pgEnum("scene_status", [
	SceneStatus.PLANNED,
	SceneStatus.KEYFRAME_PENDING,
	SceneStatus.KEYFRAME_READY,
	SceneStatus.VIDEO_PENDING,
	SceneStatus.VIDEO_READY,
	SceneStatus.FAILED,
]);

export const assetKindEnum = pgEnum("asset_kind", [
	AssetKind.CHARACTER_SHEET,
	AssetKind.LOCATION_SHEET,
	AssetKind.KEYFRAME,
	AssetKind.SCENE_VIDEO,
	AssetKind.SCENE_AUDIO,
	AssetKind.RENDER,
]);

export const assetStatusEnum = pgEnum("asset_status", [
	AssetStatus.PENDING,
	AssetStatus.READY,
	AssetStatus.FAILED,
]);

export const versionStatusEnum = pgEnum("version_status", [
	VersionStatus.RENDERING,
	VersionStatus.READY,
	VersionStatus.FAILED,
]);

export const aspectRatioEnum = pgEnum("aspect_ratio", [
	AspectRatio.LANDSCAPE,
	AspectRatio.PORTRAIT,
]);

export const templateKeyEnum = pgEnum("template_key", [
	TemplateKey.SOCCER,
	TemplateKey.BASKETBALL,
	TemplateKey.BASEBALL,
	TemplateKey.TENNIS,
	TemplateKey.HOCKEY,
	TemplateKey.VOLLEYBALL,
	TemplateKey.BOXING,
	TemplateKey.TRACK,
]);

export const generationTaskKindEnum = pgEnum("generation_task_kind", [
	GenerationTaskKind.SHEET,
	GenerationTaskKind.KEYFRAME,
	GenerationTaskKind.VIDEO,
	GenerationTaskKind.SPEECH,
]);

export const generationTaskStatusEnum = pgEnum("generation_task_status", [
	GenerationTaskStatus.PENDING,
	GenerationTaskStatus.SUCCESS,
	GenerationTaskStatus.FAILED,
]);
