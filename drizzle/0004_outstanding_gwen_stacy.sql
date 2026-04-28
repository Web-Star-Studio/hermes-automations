CREATE TYPE "public"."portal_session_status" AS ENUM('active', 'closed', 'expired');--> statement-breakpoint
CREATE TABLE "portal_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"user_id" text NOT NULL,
	"browserbase_session_id" text NOT NULL,
	"connect_url" text NOT NULL,
	"status" "portal_session_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_sessions_job_id_idx" ON "portal_sessions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "portal_sessions_user_id_idx" ON "portal_sessions" USING btree ("user_id");