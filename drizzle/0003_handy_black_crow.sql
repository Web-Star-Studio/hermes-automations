CREATE TYPE "public"."job_flow_type" AS ENUM('short', 'complete');--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "flow_type" "job_flow_type" DEFAULT 'short' NOT NULL;