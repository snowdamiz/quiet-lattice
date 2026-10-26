CREATE TABLE "shards" (
	"id" text PRIMARY KEY NOT NULL,
	"epoch" timestamp with time zone NOT NULL,
	"last_time" double precision DEFAULT 0 NOT NULL,
	"season" integer DEFAULT 1 NOT NULL,
	"season_start" double precision NOT NULL,
	"season_length" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shards_season_check" CHECK ("shards"."season" >= 1),
	CONSTRAINT "shards_season_length_check" CHECK ("shards"."season_length" > 0)
);
