import { retryPhoto } from "@/ingest/photos";
import { badRequest, Uuid } from "@/server/http";

export async function POST(_request: Request, ctx: RouteContext<"/api/photos/[id]/retry">) {
  const id = Uuid.safeParse((await ctx.params).id);
  if (!id.success) return badRequest("invalid photo id");
  const retried = await retryPhoto(id.data);
  return retried
    ? Response.json({ status: "queued" }, { status: 202 })
    : Response.json({ error: "only failed photos can be retried" }, { status: 409 });
}
