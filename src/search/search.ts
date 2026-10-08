import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { Condition, ExteriorSide, PhotoAnalysis, PhotoKind, RoomType } from "@/domain/photo-analysis";
import { embedCaption, embedClipText } from "@/ingest/embeddings";
import { reciprocalRankFusion } from "./rrf";

export const SEARCH_MODES = ["caption", "clip", "hybrid"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export type SearchFilters = { kind?: PhotoKind; roomType?: RoomType; side?: ExteriorSide; condition?: Condition };

export type SearchHit = {
  photoId: string;
  estimateId: string;
  estimateName: string;
  originalName: string;
  analysis: PhotoAnalysis;
  exteriorSide: ExteriorSide | null;
  captionText: string;
  /** Cosine distance for caption/clip modes (0 is identical), RRF score for hybrid. */
  score: number;
};

export type SearchResults = Record<SearchMode, SearchHit[]>;

const CANDIDATES = 50;

type Row = {
  photo_id: string;
  estimate_id: string;
  estimate_name: string;
  original_name: string;
  analysis: PhotoAnalysis;
  exterior_side: ExteriorSide | null;
  caption_text: string;
  distance: number;
};

function filterSql({ kind, roomType, side, condition }: SearchFilters) {
  return sql.join(
    [
      sql`p.status = 'analyzed'`,
      kind ? sql`p.analysis->>'kind' = ${kind}` : sql`true`,
      side ? sql`p.exterior_side = ${side}` : sql`true`,
      roomType ? sql`p.analysis->>'roomType' = ${roomType}` : sql`true`,
      condition ? sql`p.analysis->'surfaces' @> ${JSON.stringify([{ condition }])}::jsonb` : sql`true`,
    ],
    sql` and `,
  );
}

async function nearest(column: "caption_embedding" | "clip_embedding", embedding: number[], filters: SearchFilters) {
  const vector = `[${embedding.join(",")}]`;
  return db.transaction(async (tx) => {
    // Filters run after the HNSW scan. Iterative scan keeps walking the graph
    // until enough rows survive the WHERE clause, instead of returning too few.
    await tx.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
    const rows = await tx.execute<Row>(sql`
      select p.id as photo_id, p.estimate_id, e.name as estimate_name, p.original_name,
             p.analysis, p.exterior_side, p.caption_text, p.${sql.raw(column)} <=> ${vector}::vector as distance
      from photos p join estimates e on e.id = p.estimate_id
      where ${filterSql(filters)}
      order by p.${sql.raw(column)} <=> ${vector}::vector
      limit ${CANDIDATES}`);
    return [...rows];
  });
}

function toHit(row: Row, score: number): SearchHit {
  return {
    photoId: row.photo_id,
    estimateId: row.estimate_id,
    estimateName: row.estimate_name,
    originalName: row.original_name,
    analysis: row.analysis,
    exteriorSide: row.exterior_side,
    captionText: row.caption_text,
    score,
  };
}

export async function searchPhotos(query: string, filters: SearchFilters, limit = 12): Promise<SearchResults> {
  const [captionVector, clipVector] = await Promise.all([embedCaption(query), embedClipText(query)]);
  const [captionRows, clipRows] = await Promise.all([
    nearest("caption_embedding", captionVector, filters),
    nearest("clip_embedding", clipVector, filters),
  ]);

  const byId = new Map([...captionRows, ...clipRows].map((r) => [r.photo_id, r]));
  const fused = reciprocalRankFusion([captionRows.map((r) => r.photo_id), clipRows.map((r) => r.photo_id)]);

  return {
    caption: captionRows.slice(0, limit).map((r) => toHit(r, Number(r.distance))),
    clip: clipRows.slice(0, limit).map((r) => toHit(r, Number(r.distance))),
    hybrid: fused.slice(0, limit).map((f) => toHit(byId.get(f.id)!, f.score)),
  };
}
