import { z } from "zod";
import { Condition, ExteriorSide, PhotoKind, RoomType } from "@/domain/photo-analysis";
import { badRequest } from "@/server/http";
import { searchPhotos } from "@/search/search";

const Params = z.object({
  q: z.string().trim().min(1).max(300),
  kind: PhotoKind.optional(),
  roomType: RoomType.optional(),
  side: ExteriorSide.optional(),
  condition: Condition.optional(),
});

export async function GET(request: Request) {
  const raw = Object.fromEntries(new URL(request.url).searchParams);
  const params = Params.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== "")));
  if (!params.success) return badRequest(z.prettifyError(params.error));
  const started = performance.now();
  const { q, ...filters } = params.data;
  const results = await searchPhotos(q, filters);
  return Response.json({ ...results, tookMs: Math.round(performance.now() - started) });
}
