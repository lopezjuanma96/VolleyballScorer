CREATE TABLE "phases" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"team_ids" integer[] NOT NULL,
	"third_place" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "team_home_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "team_away_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "court" SET DATA TYPE integer USING substring("court"::text from 6)::integer;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "tiebreak_min_lead" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "tiebreak_point_cap" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "tiebreak_min_lead" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "tiebreak_point_cap" integer;--> statement-breakpoint
-- Until now the deciding set shared the lead and the cap of the other sets: keep that.
UPDATE "categories" SET "tiebreak_min_lead" = "min_lead", "tiebreak_point_cap" = "point_cap";--> statement-breakpoint
UPDATE "matches" SET "tiebreak_min_lead" = "min_lead", "tiebreak_point_cap" = "point_cap";--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "label" varchar(100);--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "phase_id" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "round" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "slot" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "home_from_match_id" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "away_from_match_id" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "from_losers" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "phases" ADD CONSTRAINT "phases_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "phases_category_idx" ON "phases" USING btree ("category_id");--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_phase_id_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."phases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matches_phase_idx" ON "matches" USING btree ("phase_id");--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_court_range" CHECK ("matches"."court" between 1 and 20);--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_teams_known" CHECK ("matches"."phase_id" is not null or ("matches"."team_home_id" is not null and "matches"."team_away_id" is not null));--> statement-breakpoint
DROP TYPE "public"."court";