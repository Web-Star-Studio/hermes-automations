CREATE TYPE "public"."user_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "status" "user_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
-- Existing accounts predate the approval gate; grandfather them in as approved
-- so they don't get locked out on deploy.
UPDATE "user" SET "status" = 'approved' WHERE "created_at" < now();