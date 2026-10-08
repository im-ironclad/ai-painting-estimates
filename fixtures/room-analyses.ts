import type { RoomAnalysis } from "../src/domain/room-analysis";

/**
 * FIXTURE DATA. Hand-written analyses for the photos in samples/, standing in
 * for the vision model until OPENROUTER_API_KEY exists. Written by a human
 * looking at each photo; the numbers are plausible, not measured.
 */
export const FIXTURE_ANALYSES: Record<string, RoomAnalysis> = {
  "bedroom.jpg": {
    roomType: "bedroom",
    surfaces: [
      { kind: "walls", condition: "good", estimatedSqFt: 400 },
      { kind: "ceiling", condition: "good", estimatedSqFt: 140 },
      { kind: "trim", condition: "good", estimatedSqFt: 40 },
    ],
    estimatedFloorSqFt: 140,
    ceilingHeightFt: 8.5,
    currentColors: ["white"],
    prep: { patching: false, waterDamage: false, wallpaperRemoval: false, highCeilings: false },
    confidence: 0.7,
    notes: "Mirrored wardrobe doors and carpet need masking. Walls are clean.",
  },
  "kitchen.jpg": {
    roomType: "kitchen",
    surfaces: [
      { kind: "walls", condition: "good", estimatedSqFt: 320 },
      { kind: "ceiling", condition: "fair", estimatedSqFt: 220 },
      { kind: "cabinets", condition: "good", estimatedSqFt: 90 },
      { kind: "trim", condition: "fair", estimatedSqFt: 60 },
    ],
    estimatedFloorSqFt: 220,
    ceilingHeightFt: 9,
    currentColors: ["white", "light grey"],
    prep: { patching: false, waterDamage: false, wallpaperRemoval: false, highCeilings: false },
    confidence: 0.6,
    notes: "Open plan kitchen into living area with crown molding and a dropped bulkhead. Grey island cabinets.",
  },
  "water-damaged-ceiling.jpg": {
    roomType: "other",
    surfaces: [{ kind: "ceiling", condition: "poor", estimatedSqFt: 150 }],
    estimatedFloorSqFt: 150,
    ceilingHeightFt: 8,
    currentColors: ["white"],
    prep: { patching: true, waterDamage: true, wallpaperRemoval: false, highCeilings: false },
    confidence: 0.4,
    notes: "Large area of peeling paint and exposed drywall paper from a leak. Fix the leak source before painting.",
  },
  "bathroom.jpg": {
    roomType: "bathroom",
    surfaces: [
      { kind: "walls", condition: "fair", estimatedSqFt: 180 },
      { kind: "ceiling", condition: "fair", estimatedSqFt: 50 },
    ],
    estimatedFloorSqFt: 50,
    ceilingHeightFt: 8,
    currentColors: ["white"],
    prep: { patching: false, waterDamage: false, wallpaperRemoval: false, highCeilings: false },
    confidence: 0.55,
    notes: "Tiled shower walls and the mirror wall are excluded. Use a mildew-resistant bathroom paint.",
  },
  "living-room.jpg": {
    roomType: "living_room",
    surfaces: [
      { kind: "walls", condition: "good", estimatedSqFt: 520 },
      { kind: "ceiling", condition: "good", estimatedSqFt: 300 },
      { kind: "trim", condition: "fair", estimatedSqFt: 70 },
    ],
    estimatedFloorSqFt: 300,
    ceilingHeightFt: 9,
    currentColors: ["off-white", "white"],
    prep: { patching: false, waterDamage: false, wallpaperRemoval: false, highCeilings: false },
    confidence: 0.6,
    notes: "White plank ceiling and large windows reduce wall area. Furniture needs moving and covering.",
  },
  "living-room-rural.jpg": {
    roomType: "living_room",
    surfaces: [
      { kind: "walls", condition: "poor", estimatedSqFt: 450 },
    ],
    estimatedFloorSqFt: 220,
    ceilingHeightFt: 11,
    currentColors: ["peach", "salmon pink"],
    prep: { patching: true, waterDamage: false, wallpaperRemoval: false, highCeilings: true },
    confidence: 0.3,
    notes: "Close-up of one rough plaster wall hung with framed pictures. Visible cracks and chipped plaster need patching.",
  },
};
