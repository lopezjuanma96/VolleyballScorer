CREATE TYPE "public"."court" AS ENUM('court1', 'court2');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('upcoming', 'in_progress', 'finished_home', 'finished_away', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."set_status" AS ENUM('in_progress', 'finished_home', 'finished_away', 'cancelled');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "clubs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	CONSTRAINT "clubs_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_home_id" integer NOT NULL,
	"team_away_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"court" "court" NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"status" "match_status" DEFAULT 'upcoming' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "points" (
	"id" serial PRIMARY KEY NOT NULL,
	"set_id" integer NOT NULL,
	"score_home" integer NOT NULL,
	"score_away" integer NOT NULL,
	"home_scored" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"set_number" integer NOT NULL,
	"status" "set_status" DEFAULT 'in_progress' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"club_id" integer NOT NULL,
	"category_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_team_home_id_teams_id_fk" FOREIGN KEY ("team_home_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_team_away_id_teams_id_fk" FOREIGN KEY ("team_away_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points" ADD CONSTRAINT "points_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;