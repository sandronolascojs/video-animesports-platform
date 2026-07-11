CREATE TYPE "public"."generation_task_kind" AS ENUM('sheet', 'keyframe', 'video', 'speech');--> statement-breakpoint
CREATE TYPE "public"."generation_task_status" AS ENUM('pending', 'success', 'failed');--> statement-breakpoint
CREATE TABLE "generation_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"scene_id" text,
	"kie_task_id" text NOT NULL,
	"workflow_instance_id" text NOT NULL,
	"kind" "generation_task_kind" NOT NULL,
	"status" "generation_task_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "plan" jsonb;--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD CONSTRAINT "generation_tasks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD CONSTRAINT "generation_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD CONSTRAINT "generation_tasks_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_tasks_user_id_idx" ON "generation_tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "generation_tasks_project_id_idx" ON "generation_tasks" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_tasks_kie_task_id_unique" ON "generation_tasks" USING btree ("kie_task_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "generation_tasks" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "service_lookup_by_task_id" ON "generation_tasks" AS PERMISSIVE FOR SELECT TO public USING (true);