import { z } from "zod";

export const Uuid = z.uuid();

export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export function notFound(what: string) {
  return Response.json({ error: `${what} not found` }, { status: 404 });
}
