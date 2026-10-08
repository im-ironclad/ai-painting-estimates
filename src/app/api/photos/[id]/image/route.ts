import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getPhotoFile } from "@/server/estimates";
import { badRequest, notFound, Uuid } from "@/server/http";

const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const THUMB_WIDTH = 640;

/** `?size=thumb` returns a small WebP for the home cards. Uploads run to 15 MB, too heavy for a grid of them. */
export async function GET(request: Request, ctx: RouteContext<"/api/photos/[id]/image">) {
  const id = Uuid.safeParse((await ctx.params).id);
  if (!id.success) return badRequest("invalid photo id");
  const photo = await getPhotoFile(id.data);
  if (!photo) return notFound("photo");
  const bytes = await readFile(photo.filePath);
  const thumb = new URL(request.url).searchParams.get("size") === "thumb";
  const body = thumb
    ? await sharp(bytes).rotate().resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 70 }).toBuffer()
    : bytes;
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": thumb ? "image/webp" : (TYPES[path.extname(photo.filePath)] ?? "application/octet-stream"),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
