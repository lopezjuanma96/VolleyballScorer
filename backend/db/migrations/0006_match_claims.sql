ALTER TABLE "matches" ADD COLUMN "claimed_by" varchar(254);--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "claimed_name" varchar(100);--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "claimed_at" timestamp with time zone;