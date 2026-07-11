CREATE TYPE "public"."aspect_ratio" AS ENUM('16:9', '9:16');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('character_sheet', 'location_sheet', 'keyframe', 'scene_video', 'scene_audio', 'render');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."audio_language" AS ENUM('ja', 'en');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'planning', 'storyboard', 'generating', 'assembling', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scene_status" AS ENUM('planned', 'keyframe_pending', 'keyframe_ready', 'video_pending', 'video_ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."subtitle_language" AS ENUM('en', 'ja');--> statement-breakpoint
CREATE TYPE "public"."template_key" AS ENUM('soccer', 'basketball', 'baseball', 'tennis');--> statement-breakpoint
CREATE TYPE "public"."version_status" AS ENUM('rendering', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"status" "asset_status" DEFAULT 'pending' NOT NULL,
	"r2_key" text,
	"content_type" text,
	"size" integer,
	"metadata" jsonb,
	"source" text,
	"fail_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"template_key" "template_key" NOT NULL,
	"description" text NOT NULL,
	"title" text,
	"synopsis" text,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"aspect_ratio" "aspect_ratio" NOT NULL,
	"audio_language" "audio_language" NOT NULL,
	"subtitle_language" "subtitle_language" NOT NULL,
	"style_bible" jsonb,
	"subtitle_style" jsonb,
	"draft_timeline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"prompt" text NOT NULL,
	"dialogue" text,
	"subtitle_text" text,
	"status" "scene_status" DEFAULT 'planned' NOT NULL,
	"duration_seconds" integer NOT NULL,
	"start_keyframe_asset_id" text,
	"end_keyframe_asset_id" text,
	"video_asset_id" text,
	"audio_asset_id" text,
	"fail_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scenes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"number" integer NOT NULL,
	"timeline" jsonb NOT NULL,
	"render_asset_id" text,
	"status" "version_status" DEFAULT 'rendering' NOT NULL,
	"fail_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_versions_project_id_number_unique" UNIQUE("project_id","number")
);
--> statement-breakpoint
ALTER TABLE "project_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_start_keyframe_asset_id_assets_id_fk" FOREIGN KEY ("start_keyframe_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_end_keyframe_asset_id_assets_id_fk" FOREIGN KEY ("end_keyframe_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_video_asset_id_assets_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_audio_asset_id_assets_id_fk" FOREIGN KEY ("audio_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_render_asset_id_assets_id_fk" FOREIGN KEY ("render_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_project_id_idx" ON "assets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "assets_user_id_idx" ON "assets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "assets_status_idx" ON "assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_user_id_idx" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scenes_project_id_idx" ON "scenes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "scenes_user_id_idx" ON "scenes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scenes_status_idx" ON "scenes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "project_versions_project_id_idx" ON "project_versions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_versions_user_id_idx" ON "project_versions" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "assets" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "projects" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "scenes" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "project_versions" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));