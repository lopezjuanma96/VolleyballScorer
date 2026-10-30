CREATE TYPE "public"."point_kind" AS ENUM('rally', 'final', 'correction');--> statement-breakpoint
CREATE TYPE "public"."team_side" AS ENUM('home', 'away');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'scorer');--> statement-breakpoint
CREATE TABLE "set_lineups" (
	"id" serial PRIMARY KEY NOT NULL,
	"set_id" integer NOT NULL,
	"side" "team_side" NOT NULL,
	"positions" integer[] NOT NULL,
	CONSTRAINT "set_lineups_six" CHECK (cardinality("set_lineups"."positions") = 6)
);
--> statement-breakpoint
CREATE TABLE "substitutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"set_id" integer NOT NULL,
	"side" "team_side" NOT NULL,
	"after_rallies" integer NOT NULL,
	"player_out" integer NOT NULL,
	"player_in" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(50) NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" "user_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"session_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "best_of" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "set_points" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "tiebreak_points" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "min_lead" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "point_cap" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "best_of" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "set_points" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "tiebreak_points" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "min_lead" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "point_cap" integer;--> statement-breakpoint
ALTER TABLE "points" ADD COLUMN "kind" "point_kind" DEFAULT 'rally' NOT NULL;--> statement-breakpoint
ALTER TABLE "sets" ADD COLUMN "first_serve_home" boolean;--> statement-breakpoint
ALTER TABLE "set_lineups" ADD CONSTRAINT "set_lineups_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "set_lineups_set_side_idx" ON "set_lineups" USING btree ("set_id","side");--> statement-breakpoint
CREATE INDEX "substitutions_set_idx" ON "substitutions" USING btree ("set_id","id");--> statement-breakpoint
-- Earlier administrative corrections must never be undone as if they were rallies.
UPDATE "points" SET "kind" = 'correction' WHERE "id" IN (SELECT ("after"->>'lastPointId')::integer FROM "scoring_audit" WHERE "action" = 'set_correction' AND "after" ? 'lastPointId');
