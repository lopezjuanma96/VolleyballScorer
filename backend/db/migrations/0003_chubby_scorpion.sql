CREATE TABLE "scoring_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"set_id" integer,
	"action" varchar(40) NOT NULL,
	"actor" varchar(100) NOT NULL,
	"reason" varchar(500) NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sets" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scoring_audit" ADD CONSTRAINT "scoring_audit_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_audit" ADD CONSTRAINT "scoring_audit_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scoring_audit_match_idx" ON "scoring_audit" USING btree ("match_id","id");