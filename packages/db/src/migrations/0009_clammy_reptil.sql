ALTER TABLE "scenes" DROP CONSTRAINT "scenes_audio_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."asset_kind";--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('character_sheet', 'location_sheet', 'keyframe', 'scene_video', 'render');--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "kind" SET DATA TYPE "public"."asset_kind" USING "kind"::"public"."asset_kind";--> statement-breakpoint
ALTER TABLE "generation_tasks" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."generation_task_kind";--> statement-breakpoint
CREATE TYPE "public"."generation_task_kind" AS ENUM('sheet', 'keyframe', 'video');--> statement-breakpoint
ALTER TABLE "generation_tasks" ALTER COLUMN "kind" SET DATA TYPE "public"."generation_task_kind" USING "kind"::"public"."generation_task_kind";--> statement-breakpoint
ALTER TABLE "scenes" DROP COLUMN "audio_asset_id";