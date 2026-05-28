CREATE TYPE "public"."ingest_source" AS ENUM('usa_spending', 'irs_soi', 'census', 'medsl_voting');
--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('pending', 'running', 'complete', 'failed');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "states" (
	"fips" char(2) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"abbreviation" char(2) NOT NULL,
	CONSTRAINT "states_abbreviation_unique" UNIQUE("abbreviation")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "ingest_source" NOT NULL,
	"fiscal_year" integer NOT NULL,
	"status" "ingest_status" DEFAULT 'pending' NOT NULL,
	"triggered_by" varchar(100),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raw_federal_spending" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingest_run_id" uuid NOT NULL,
	"state_fips" char(2) NOT NULL,
	"fiscal_year" integer NOT NULL,
	"category" varchar(30) NOT NULL,
	"amount_cents" bigint NOT NULL,
	CONSTRAINT "raw_spending_unique" UNIQUE("ingest_run_id","state_fips","fiscal_year","category")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raw_tax_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingest_run_id" uuid NOT NULL,
	"state_fips" char(2) NOT NULL,
	"fiscal_year" integer NOT NULL,
	"tax_type" varchar(30) NOT NULL,
	"amount_cents" bigint NOT NULL,
	CONSTRAINT "raw_tax_unique" UNIQUE("ingest_run_id","state_fips","fiscal_year","tax_type")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raw_population" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingest_run_id" uuid NOT NULL,
	"state_fips" char(2) NOT NULL,
	"census_year" integer NOT NULL,
	"population" integer NOT NULL,
	CONSTRAINT "raw_population_unique" UNIQUE("state_fips","census_year")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "state_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_fips" char(2) NOT NULL,
	"fiscal_year" integer NOT NULL,
	"total_received_cents" bigint NOT NULL,
	"total_paid_in_cents" bigint NOT NULL,
	"net_cents" bigint NOT NULL,
	"population" integer,
	"net_per_capita_cents" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"spending_run_id" uuid NOT NULL,
	"tax_run_id" uuid NOT NULL,
	CONSTRAINT "state_balance_unique" UNIQUE("state_fips","fiscal_year"),
	CONSTRAINT "net_cents_check" CHECK ("state_balances"."net_cents" = "state_balances"."total_received_cents" - "state_balances"."total_paid_in_cents"),
	CONSTRAINT "per_capita_null_parity" CHECK (("state_balances"."population" IS NULL) = ("state_balances"."net_per_capita_cents" IS NULL))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_federal_spending" ADD CONSTRAINT "raw_federal_spending_ingest_run_id_ingest_runs_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_federal_spending" ADD CONSTRAINT "raw_federal_spending_state_fips_states_fips_fk" FOREIGN KEY ("state_fips") REFERENCES "public"."states"("fips") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_tax_receipts" ADD CONSTRAINT "raw_tax_receipts_ingest_run_id_ingest_runs_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_tax_receipts" ADD CONSTRAINT "raw_tax_receipts_state_fips_states_fips_fk" FOREIGN KEY ("state_fips") REFERENCES "public"."states"("fips") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_population" ADD CONSTRAINT "raw_population_ingest_run_id_ingest_runs_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_population" ADD CONSTRAINT "raw_population_state_fips_states_fips_fk" FOREIGN KEY ("state_fips") REFERENCES "public"."states"("fips") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "state_balances" ADD CONSTRAINT "state_balances_state_fips_states_fips_fk" FOREIGN KEY ("state_fips") REFERENCES "public"."states"("fips") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "state_balances" ADD CONSTRAINT "state_balances_spending_run_id_ingest_runs_id_fk" FOREIGN KEY ("spending_run_id") REFERENCES "public"."ingest_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "state_balances" ADD CONSTRAINT "state_balances_tax_run_id_ingest_runs_id_fk" FOREIGN KEY ("tax_run_id") REFERENCES "public"."ingest_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
