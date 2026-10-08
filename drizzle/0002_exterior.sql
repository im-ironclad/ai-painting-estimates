CREATE TYPE "public"."exterior_scope" AS ENUM('undecided', 'single_side', 'whole_exterior');--> statement-breakpoint
CREATE TYPE "public"."exterior_side" AS ENUM('front', 'back', 'left', 'right');--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "exterior_scope" "exterior_scope" DEFAULT 'undecided' NOT NULL;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "exterior_side" "exterior_side";--> statement-breakpoint
-- Rows written before photos could be exteriors are all interiors. Tag them so every stored analysis parses as the union.
UPDATE "photos" SET "analysis" = jsonb_build_object('kind', 'interior') || "analysis" WHERE "analysis" IS NOT NULL AND NOT "analysis" ? 'kind';--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_analyzed_exterior_has_side" CHECK ("photos"."status" <> 'analyzed' or (("photos"."analysis"->>'kind' = 'exterior') = ("photos"."exterior_side" is not null)));