import { readFile } from "node:fs/promises";
import path from "node:path";
import { getPhotoFile } from "@/server/estimates";
import { badRequest, notFound, Uuid } from "@/server/http";

const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

export async function GET(_request: Request, ctx: RouteContext<"/api/photos/[id]/image">) {
  const id = Uuid.safeParse((await ctx.params).id);
  if (!id.success) return badRequest("invalid photo id");
  const photo = await getPhotoFile(id.data);
  if (!photo) return notFound("photo");
  const bytes = await readFile(photo.filePath);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": TYPES[path.extname(photo.filePath)] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
