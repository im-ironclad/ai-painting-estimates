import { z } from "zod";
import { ExteriorSide } from "@/domain/photo-analysis";
import { setPhotoSide } from "@/server/estimates";
import { badRequest, Uuid } from "@/server/http";

const Patch = z.object({ exteriorSide: ExteriorSide }).strict();

export async function PATCH(request: Request, ctx: RouteContext<"/api/photos/[id]">) {
  const id = Uuid.safeParse((await ctx.params).id);
  if (!id.success) return badRequest("invalid photo id");
  const body = Patch.safeParse(await request.json().catch(() => null));
  if (!body.success) return badRequest(z.prettifyError(body.error));
  return (await setPhotoSide(id.data, body.data.exteriorSide))
    ? Response.json({ exteriorSide: body.data.exteriorSide })
    : Response.json({ error: "only an analyzed exterior photo has a side" }, { status: 409 });
}
