CREATE TABLE "count_days" (
	"shard_id" text NOT NULL,
	"day" integer NOT NULL,
	"season" integer NOT NULL,
	"votes" integer NOT NULL,
	"lean" double precision,
	"target" integer,
	"count_from" integer NOT NULL,
	"drift" integer NOT NULL,
	"burn" integer NOT NULL,
	"count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "count_days_shard_id_day_pk" PRIMARY KEY("shard_id","day")
);
--> statement-breakpoint
CREATE TABLE "count_votes" (
	"shard_id" text NOT NULL,
	"day" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"action" text NOT NULL,
	"tag" text NOT NULL,
	"at" double precision NOT NULL,
	CONSTRAINT "count_votes_shard_id_day_account_id_action_pk" PRIMARY KEY("shard_id","day","account_id","action"),
	CONSTRAINT "count_votes_tag_check" CHECK ("count_votes"."tag" in ('feed', 'hold', 'break'))
);
--> statement-breakpoint
ALTER TABLE "shards" ADD COLUMN "count" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "shards" ADD COLUMN "count_day" integer;--> statement-breakpoint
ALTER TABLE "count_days" ADD CONSTRAINT "count_days_shard_id_shards_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."shards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_votes" ADD CONSTRAINT "count_votes_shard_id_shards_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."shards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shards" ADD CONSTRAINT "shards_count_check" CHECK ("shards"."count" between 0 and 1000);