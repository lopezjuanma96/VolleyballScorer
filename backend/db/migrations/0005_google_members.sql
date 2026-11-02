-- Members now sign in with Google by email. Existing password accounts are kept
-- as inactive placeholders (username@sin-email.invalid) so the manager can set
-- their real email or delete them; their open sessions end.
ALTER TABLE "users" ADD COLUMN "email" varchar(254);--> statement-breakpoint
UPDATE "users" SET "email" = "username" || '@sin-email.invalid', "active" = false, "session_version" = "session_version" + 1;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_username_unique";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "username";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_hash";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");
