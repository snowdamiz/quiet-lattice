CREATE TABLE "daily_actives" (
	"shard_id" text NOT NULL,
	"day" integer NOT NULL,
	"account_id" uuid NOT NULL,
	CONSTRAINT "daily_actives_shard_id_day_account_id_pk" PRIMARY KEY("shard_id","day","account_id")
);
--> statement-breakpoint
CREATE TABLE "season_awards" (
	"shard_id" text NOT NULL,
	"season" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"title" text NOT NULL,
	"glyph" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "season_awards_shard_id_season_account_id_pk" PRIMARY KEY("shard_id","season","account_id"),
	CONSTRAINT "season_awards_bucket_check" CHECK ("season_awards"."bucket" in ('fed', 'held', 'broken'))
);
--> statement-breakpoint
CREATE TABLE "season_chronicles" (
	"shard_id" text NOT NULL,
	"season" integer NOT NULL,
	"season_start" double precision NOT NULL,
	"season_end" double precision NOT NULL,
	"season_length" integer NOT NULL,
	"actives" double precision,
	"opening" jsonb NOT NULL,
	"count" integer NOT NULL,
	"bucket" text NOT NULL,
	"philosophy" text NOT NULL,
	"title" text NOT NULL,
	"glyph" text NOT NULL,
	"awarded" integer NOT NULL,
	"next" jsonb NOT NULL,
	"finds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "season_chronicles_shard_id_season_pk" PRIMARY KEY("shard_id","season"),
	CONSTRAINT "season_chronicles_bucket_check" CHECK ("season_chronicles"."bucket" in ('fed', 'held', 'broken')),
	CONSTRAINT "season_chronicles_count_check" CHECK ("season_chronicles"."count" between 0 and 1000)
);
--> statement-breakpoint
ALTER TABLE "shards" ADD COLUMN "season_actives" double precision;--> statement-breakpoint
ALTER TABLE "shards" ADD COLUMN "season_opening" jsonb DEFAULT '{"from":null,"edgeShiftLy":0,"dark":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_actives" ADD CONSTRAINT "daily_actives_shard_id_shards_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."shards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_awards" ADD CONSTRAINT "season_awards_shard_id_shards_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."shards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_chronicles" ADD CONSTRAINT "season_chronicles_shard_id_shards_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."shards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "season_awards_account_idx" ON "season_awards" USING btree ("shard_id","account_id");