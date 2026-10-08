import { db } from "@/db/client";
import { createPhoto, UploadError } from "@/ingest/photos";
import { badRequest, notFound, Uuid } from "@/server/http";

export async function POST(request: Request, ctx: RouteContext<"/api/estimates/[id]/photos">) {
  const id = Uuid.safeParse((await ctx.params).id);
  if (!id.success) return badRequest("invalid estimate id");
  const estimate = await db.query.estimates.findFirst({ where: (e, { eq }) => eq(e.id, id.data) });
  if (!estimate) return notFound("estimate");

  const files = (await request.formData()).getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return badRequest("attach at least one image as `files`");

  try {
    const ids = [];
    for (const file of files) {
      ids.push(
        await createPhoto(id.data, { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) }),
      );
    }
    return Response.json({ ids }, { status: 202 });
  } catch (err) {
    if (err instanceof UploadError) return badRequest(err.message);
    throw err;
  }
}
