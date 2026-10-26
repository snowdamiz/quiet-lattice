CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"people" text NOT NULL,
	"look" jsonb NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"xp" bigint DEFAULT 0 NOT NULL,
	"home_system" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "characters_people_check" CHECK ("characters"."people" in ('thalune', 'ixari', 'ulgani')),
	CONSTRAINT "characters_level_check" CHECK ("characters"."level" between 1 and 50)
);
--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_username_lower_key" ON "accounts" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "characters_name_lower_key" ON "characters" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "characters_account_id_idx" ON "characters" USING btree ("account_id");