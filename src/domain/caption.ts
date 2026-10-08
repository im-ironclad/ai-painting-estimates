import type { ExteriorAnalysis, InteriorAnalysis, PhotoAnalysis } from "./photo-analysis";

const label = (s: string) => s.replaceAll("_", " ");

type Surface = { kind: string; condition: string; estimatedSqFt: number };

function surfaceLine(surfaces: readonly Surface[]): string {
  const parts = [...surfaces]
    .sort((x, y) => x.kind.localeCompare(y.kind))
    .map((s) => `${label(s.kind)} in ${s.condition} condition (${Math.round(s.estimatedSqFt)} sq ft)`);
  return `Surfaces: ${parts.length > 0 ? parts.join("; ") : "none visible"}.`;
}

function listLine(name: string, items: (string | false)[], empty: string): string {
  const present = items.filter(Boolean);
  return `${name}: ${present.length > 0 ? present.join(", ") : empty}.`;
}

function interiorCaption(a: InteriorAnalysis): string {
  return [
    `Room: ${label(a.roomType)}.`,
    surfaceLine(a.surfaces),
    listLine("Current colors", a.currentColors, "unknown"),
    listLine(
      "Prep",
      [
        a.prep.patching && "patching needed",
        a.prep.waterDamage && "water damage",
        a.prep.wallpaperRemoval && "wallpaper removal",
        a.prep.highCeilings && "high ceilings",
      ],
      "none",
    ),
    `Floor area: ${Math.round(a.estimatedFloorSqFt)} sq ft. Ceiling height: ${a.ceilingHeightFt} ft.`,
    `Notes: ${a.notes.trim()}`,
  ].join("\n");
}

/** The side is left out on purpose: the user can correct it, and a stale side would sit in the embedding. */
function exteriorCaption(a: ExteriorAnalysis): string {
  return [
    `Exterior: ${a.stories}-story house with ${label(a.sidingMaterial)} siding.`,
    surfaceLine(a.surfaces),
    listLine("Current colors", a.currentColors, "unknown"),
    listLine(
      "Prep",
      [
        a.prep.peeling && "peeling paint",
        a.prep.mildew && "mildew",
        a.prep.woodRot && "wood rot",
        a.prep.failedCaulk && "failed caulk",
      ],
      "none",
    ),
    `Notes: ${a.notes.trim()}`,
  ].join("\n");
}

/**
 * Canonical text form of an analysis. Same analysis in, same string out:
 * fixed field order, sorted surfaces, no timestamps or ids. The caption
 * embedding is computed from this string, so any change here changes search.
 */
export function renderCaption(a: PhotoAnalysis): string {
  switch (a.kind) {
    case "interior":
      return interiorCaption(a);
    case "exterior":
      return exteriorCaption(a);
  }
}
