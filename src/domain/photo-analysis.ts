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

export const PHOTO_KINDS = ["interior", "exterior"] as const;
export const EXTERIOR_SIDES = ["front", "back", "left", "right"] as const;
export const SIDING_MATERIALS = ["wood", "vinyl", "fiber_cement", "stucco", "brick", "other"] as const;
export const EXTERIOR_SURFACE_KINDS = [
  "siding",
  "trim",
  "doors",
  "shutters",
  "garage_door",
  "fascia_soffit",
  "deck_porch",
] as const;
export const STORIES = [1, 2, 3] as const;

export const RoomType = z.enum(ROOM_TYPES);
export const SurfaceKind = z.enum(SURFACE_KINDS);
export const Condition = z.enum(CONDITIONS);
export const PhotoKind = z.enum(PHOTO_KINDS);
export const ExteriorSide = z.enum(EXTERIOR_SIDES);
export const SidingMaterial = z.enum(SIDING_MATERIALS);
export const ExteriorSurfaceKind = z.enum(EXTERIOR_SURFACE_KINDS);
export const Stories = z.literal(STORIES);

export type RoomType = z.infer<typeof RoomType>;
export type SurfaceKind = z.infer<typeof SurfaceKind>;
export type Condition = z.infer<typeof Condition>;
export type PhotoKind = z.infer<typeof PhotoKind>;
export type ExteriorSide = z.infer<typeof ExteriorSide>;
export type SidingMaterial = z.infer<typeof SidingMaterial>;
export type ExteriorSurfaceKind = z.infer<typeof ExteriorSurfaceKind>;
export type Stories = z.infer<typeof Stories>;

const SqFt = z.number().min(0).max(20000);
const Confidence = z.number().min(0).max(1).describe("How confident you are in these measurements, 0 to 1");
const Colors = z.array(z.string()).describe("Plain color names of the current paint, e.g. 'warm white'");
const Notes = z.string().describe("One or two sentences a painter would want to know");

export const InteriorAnalysis = z
  .object({
    kind: z.literal("interior"),
    roomType: RoomType,
    surfaces: z
      .array(
        z
          .object({
            kind: SurfaceKind,
            condition: Condition,
            estimatedSqFt: SqFt.describe("Paintable area of this surface in square feet"),
          })
          .strict(),
      )
      .describe("One entry per paintable surface kind visible in the photo"),
    estimatedFloorSqFt: SqFt,
    ceilingHeightFt: z.number().min(6).max(30),
    currentColors: Colors,
    prep: z
      .object({
        patching: z.boolean().describe("Holes, cracks, or dents that need filling"),
        waterDamage: z.boolean().describe("Stains or peeling from moisture"),
        wallpaperRemoval: z.boolean().describe("Wallpaper is present and must come off"),
        highCeilings: z.boolean().describe("Ceilings above 10 ft that need extra ladder or scaffold work"),
      })
      .strict(),
    confidence: Confidence,
    notes: Notes,
  })
  .strict();

export const ExteriorAnalysis = z
  .object({
    kind: z.literal("exterior"),
    sideGuess: ExteriorSide.describe(
      "Which side of the house this photo most likely shows. The front faces the street and usually has the main entry.",
    ),
    sidingMaterial: SidingMaterial,
    stories: Stories.describe("Stories of wall visible on this side. Use 3 for three or more."),
    surfaces: z
      .array(
        z
          .object({
            kind: ExteriorSurfaceKind,
            condition: Condition,
            estimatedSqFt: SqFt.describe("Paintable area of this surface on this side in square feet"),
          })
          .strict(),
      )
      .describe("One entry per paintable exterior surface kind visible on this side"),
    currentColors: Colors,
    prep: z
      .object({
        peeling: z.boolean().describe("Peeling, flaking, or blistering paint that needs scraping"),
        mildew: z.boolean().describe("Mildew, algae, or heavy dirt that needs washing and treatment"),
        woodRot: z.boolean().describe("Soft, split, or rotted wood that needs repair before paint"),
        failedCaulk: z.boolean().describe("Open or cracked joints around trim, windows, or doors"),
      })
      .strict(),
    confidence: Confidence,
    notes: Notes,
  })
  .strict();

export const PhotoAnalysis = z.discriminatedUnion("kind", [InteriorAnalysis, ExteriorAnalysis]);

export type InteriorAnalysis = z.infer<typeof InteriorAnalysis>;
export type ExteriorAnalysis = z.infer<typeof ExteriorAnalysis>;
export type PhotoAnalysis = z.infer<typeof PhotoAnalysis>;

/**
 * What the model must return. Strict structured outputs require an object at
 * the root, so the union sits under one key. `oneOf` and `const` become
 * `anyOf` and `enum` because not every provider accepts the former; the
 * branches are disjoint on `kind`, so the meaning is the same.
 */
const ModelReply = z.object({ analysis: PhotoAnalysis }).strict();

export const photoAnalysisJsonSchema = z.toJSONSchema(ModelReply, {
  target: "draft-7",
  override: ({ jsonSchema }) => {
    if (jsonSchema.oneOf) {
      jsonSchema.anyOf = jsonSchema.oneOf;
      delete jsonSchema.oneOf;
    }
    if (jsonSchema.const !== undefined) {
      jsonSchema.enum = [jsonSchema.const];
      delete jsonSchema.const;
    }
  },
});

export type ParseResult = { ok: true; analysis: PhotoAnalysis } | { ok: false; error: string };

export function parsePhotoAnalysis(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: `Model output is not JSON: ${raw.slice(0, 120)}` };
  }
  const result = ModelReply.safeParse(json);
  if (!result.success) {
    return { ok: false, error: `Model output failed validation: ${z.prettifyError(result.error)}` };
  }
  return { ok: true, analysis: result.data.analysis };
}
