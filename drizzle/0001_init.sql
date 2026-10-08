CREATE TYPE "public"."photo_status" AS ENUM('queued', 'analyzing', 'analyzed', 'failed');--> statement-breakpoint
CREATE TABLE "estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"estimate_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"original_name" text NOT NULL,
	"status" "photo_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"model" text,
	"analysis" jsonb,
	"caption_text" text,
	"caption_embedding" vector(384),
	"clip_embedding" vector(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"analyzed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photos_estimate_id_idx" ON "photos" USING btree ("estimate_id");--> statement-breakpoint
CREATE INDEX "photos_caption_embedding_idx" ON "photos" USING hnsw ("caption_embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "photos_clip_embedding_idx" ON "photos" USING hnsw ("clip_embedding" vector_cosine_ops);