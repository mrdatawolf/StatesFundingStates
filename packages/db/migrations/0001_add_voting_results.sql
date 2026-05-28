CREATE TABLE IF NOT EXISTS "raw_voting_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingest_run_id" uuid NOT NULL,
	"state_fips" char(2) NOT NULL,
	"election_year" integer NOT NULL,
	"dem_votes" integer NOT NULL,
	"rep_votes" integer NOT NULL,
	"other_votes" integer NOT NULL,
	"total_votes" integer NOT NULL,
	CONSTRAINT "raw_voting_unique" UNIQUE("state_fips","election_year")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_voting_results" ADD CONSTRAINT "raw_voting_results_ingest_run_id_ingest_runs_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_voting_results" ADD CONSTRAINT "raw_voting_results_state_fips_states_fips_fk" FOREIGN KEY ("state_fips") REFERENCES "public"."states"("fips") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
