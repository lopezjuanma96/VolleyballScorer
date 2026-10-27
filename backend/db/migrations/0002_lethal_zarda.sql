CREATE INDEX "matches_category_schedule_idx" ON "matches" USING btree ("category_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "points_set_id_idx" ON "points" USING btree ("set_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sets_match_number_idx" ON "sets" USING btree ("match_id","set_number");--> statement-breakpoint
CREATE INDEX "sets_match_idx" ON "sets" USING btree ("match_id");