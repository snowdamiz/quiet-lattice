ALTER TABLE "characters" ADD COLUMN "state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "saved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_revision_check" CHECK ("characters"."revision" >= 0);