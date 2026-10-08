import { z } from "zod";
import { EXTERIOR_SCOPES } from "@/domain/exterior";
import { getEstimateView, setExteriorScope } from "@/server/estimates";
import { badRequest, notFound, Uuid } from "@/server/http";

export async function GET(_request: Request, ctx: RouteContext<"/api/estimates/[id]">) {
  const id = Uuid.safeParse((await ctx.params).id);
  if (!id.success) return badRequest("invalid estimate id");
  const view = await getEstimateView(id.data);
  return view ? Response.json(view) : notFound("estimate");
}

const Patch = z.object({ exteriorScope: z.enum(EXTERIOR_SCOPES) }).strict();

export async function PATCH(request: Request, ctx: RouteContext<"/api/estimates/[id]">) {
  const id = Uuid.safeParse((await ctx.params).id);
  if (!id.success) return badRequest("invalid estimate id");
  const body = Patch.safeParse(await request.json().catch(() => null));
  if (!body.success) return badRequest(z.prettifyError(body.error));
  if (!(await setExteriorScope(id.data, body.data.exteriorScope))) return notFound("estimate");
  return Response.json(await getEstimateView(id.data));
}
