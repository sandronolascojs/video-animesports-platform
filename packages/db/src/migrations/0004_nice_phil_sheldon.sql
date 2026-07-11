ALTER TABLE "generation_tasks" ADD COLUMN "fail_code" text;--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD COLUMN "fail_msg" text;--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD COLUMN "step_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_tasks_step_key_unique" ON "generation_tasks" USING btree ("step_key");--> statement-breakpoint
CREATE UNIQUE INDEX "project_versions_one_rendering_per_project" ON "project_versions" USING btree ("project_id") WHERE "project_versions"."status" = 'rendering';--> statement-breakpoint
DROP TYPE "public"."video_status";