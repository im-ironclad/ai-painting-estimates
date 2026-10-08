import { z } from "zod";

export const ROOM_TYPES = [
  "living_room",
  "bedroom",
  "kitchen",
  "bathroom",
  "dining_room",
  "hallway",
  "office",
  "other",
] as const;
export const SURFACE_KINDS = ["walls", "ceiling", "trim", "doors", "cabinets"] as const;
export const CONDITIONS = ["good", "fair", "poor"] as const;

export const RoomType = z.enum(ROOM_TYPES);
export const SurfaceKind = z.enum(SURFACE_KINDS);
export const Condition = z.enum(CONDITIONS);

export type RoomType = z.infer<typeof RoomType>;
export type SurfaceKind = z.infer<typeof SurfaceKind>;
export type Condition = z.infer<typeof Condition>;

const SqFt = z.number().min(0).max(20000);

export const Surface = z
  .object({
    kind: SurfaceKind,
    condition: Condition,
    estimatedSqFt: SqFt.describe("Paintable area of this surface in square feet"),
  })
  .strict();

export const PrepFlags = z
  .object({
    patching: z.boolean().describe("Holes, cracks, or dents that need filling"),
    waterDamage: z.boolean().describe("Stains or peeling from moisture"),
    wallpaperRemoval: z.boolean().describe("Wallpaper is present and must come off"),
    highCeilings: z.boolean().describe("Ceilings above 10 ft that need extra ladder or scaffold work"),
  })
  .strict();

export const RoomAnalysis = z
  .object({
    roomType: RoomType,
    surfaces: z.array(Surface).describe("One entry per paintable surface kind visible in the photo"),
    estimatedFloorSqFt: SqFt,
    ceilingHeightFt: z.number().min(6).max(30),
    currentColors: z.array(z.string()).describe("Plain color names of the current paint, e.g. 'warm white'"),
    prep: PrepFlags,
    confidence: z.number().min(0).max(1).describe("How confident you are in these measurements, 0 to 1"),
    notes: z.string().describe("One or two sentences a painter would want to know"),
  })
  .strict();

export type RoomAnalysis = z.infer<typeof RoomAnalysis>;
export type Surface = z.infer<typeof Surface>;

export const roomAnalysisJsonSchema = z.toJSONSchema(RoomAnalysis, { target: "draft-7" });

export type ParseResult =
  | { ok: true; analysis: RoomAnalysis }
  | { ok: false; error: string };

export function parseRoomAnalysis(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: `Model output is not JSON: ${raw.slice(0, 120)}` };
  }
  const result = RoomAnalysis.safeParse(json);
  if (!result.success) {
    return { ok: false, error: `Model output failed validation: ${z.prettifyError(result.error)}` };
  }
  return { ok: true, analysis: result.data };
}
