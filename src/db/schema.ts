import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, vector } from "drizzle-orm/pg-core";
import { EXTERIOR_SCOPES } from "@/domain/exterior";
import { EXTERIOR_SIDES, type PhotoAnalysis } from "@/domain/photo-analysis";
import { PHOTO_STATUSES } from "@/domain/photo-status";

export const CAPTION_DIMENSIONS = 384;
export const CLIP_DIMENSIONS = 512;

export const photoStatus = pgEnum("photo_status", PHOTO_STATUSES);
export const exteriorSide = pgEnum("exterior_side", EXTERIOR_SIDES);
export const exteriorScope = pgEnum("exterior_scope", EXTERIOR_SCOPES);

export const estimates = pgTable("estimates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  exteriorScope: exteriorScope("exterior_scope").notNull().default("undecided"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const photos = pgTable(
  "photos",
  {
    id: uuid("id").primaryKey(),
    estimateId: uuid("estimate_id")
      .notNull()
      .references(() => estimates.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    originalName: text("original_name").notNull(),
    status: photoStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    model: text("model"),
    analysis: jsonb("analysis").$type<PhotoAnalysis>(),
    /** Set at upload from the slot, else from the model's guess on success. Pricing reads this, never the guess. */
    exteriorSide: exteriorSide("exterior_side"),
    captionText: text("caption_text"),
    captionEmbedding: vector("caption_embedding", { dimensions: CAPTION_DIMENSIONS }),
    clipEmbedding: vector("clip_embedding", { dimensions: CLIP_DIMENSIONS }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
  },
  (t) => [
    index("photos_estimate_id_idx").on(t.estimateId),
    index("photos_caption_embedding_idx").using("hnsw", t.captionEmbedding.op("vector_cosine_ops")),
    index("photos_clip_embedding_idx").using("hnsw", t.clipEmbedding.op("vector_cosine_ops")),
    check(
      "photos_analyzed_exterior_has_side",
      sql`${t.status} <> 'analyzed' or ((${t.analysis}->>'kind' = 'exterior') = (${t.exteriorSide} is not null))`,
    ),
  ],
);

export type Photo = typeof photos.$inferSelect;
export type Estimate = typeof estimates.$inferSelect;
