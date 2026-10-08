import { getEstimateView } from "@/server/estimates";
import { badRequest, notFound, Uuid } from "@/server/http";

export async function GET(_request: Request, ctx: RouteContext<"/api/estimates/[id]">) {
  const id = Uuid.safeParse((await ctx.params).id);
  if (!id.success) return badRequest("invalid estimate id");
  const view = await getEstimateView(id.data);
  return view ? Response.json(view) : notFound("estimate");
}
