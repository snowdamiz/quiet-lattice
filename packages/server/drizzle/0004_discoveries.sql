CREATE TABLE "discoveries" (
	"shard_id" text NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"system_seed" bigint NOT NULL,
	"finder_id" uuid,
	"finder_name" text NOT NULL,
	"at" double precision NOT NULL,
	"name" text,
	"name_state" text DEFAULT 'open' NOT NULL,
	"name_until" double precision NOT NULL,
	"named_at" double precision,
	"named_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discoveries_shard_id_kind_key_pk" PRIMARY KEY("shard_id","kind","key"),
	CONSTRAINT "discoveries_kind_check" CHECK ("discoveries"."kind" in ('species', 'body', 'site')),
	CONSTRAINT "discoveries_name_state_check" CHECK ("discoveries"."name_state" in ('open', 'named', 'renamed', 'cleared')),
	CONSTRAINT "discoveries_name_check" CHECK (("discoveries"."name" is null) = ("discoveries"."name_state" in ('open', 'cleared')))
);
--> statement-breakpoint
ALTER TABLE "discoveries" ADD CONSTRAINT "discoveries_shard_id_shards_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."shards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discoveries" ADD CONSTRAINT "discoveries_finder_id_characters_id_fk" FOREIGN KEY ("finder_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discoveries_system_idx" ON "discoveries" USING btree ("shard_id","system_seed");--> statement-breakpoint
CREATE INDEX "discoveries_finder_idx" ON "discoveries" USING btree ("shard_id","finder_id");