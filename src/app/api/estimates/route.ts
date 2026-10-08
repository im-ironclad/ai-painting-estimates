import { z } from "zod";
import { badRequest } from "@/server/http";
import { createEstimate } from "@/server/estimates";

const Body = z.object({ name: z.string().trim().min(1).max(120) });

export async function POST(request: Request) {
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return badRequest("name is required");
  return Response.json({ id: await createEstimate(body.data.name) }, { status: 201 });
}
