import type { RoomAnalysis } from "./room-analysis";

const label = (s: string) => s.replaceAll("_", " ");

/**
 * Canonical text form of an analysis. Same analysis in, same string out:
 * fixed field order, sorted surfaces, no timestamps or ids. The caption
 * embedding is computed from this string, so any change here changes search.
 */
export function renderCaption(a: RoomAnalysis): string {
  const surfaces = [...a.surfaces]
    .sort((x, y) => x.kind.localeCompare(y.kind))
    .map((s) => `${s.kind} in ${s.condition} condition (${Math.round(s.estimatedSqFt)} sq ft)`);
  const prep = [
    a.prep.patching && "patching needed",
    a.prep.waterDamage && "water damage",
    a.prep.wallpaperRemoval && "wallpaper removal",
    a.prep.highCeilings && "high ceilings",
  ].filter(Boolean);
  const colors = a.currentColors.length > 0 ? a.currentColors.join(", ") : "unknown";

  return [
    `Room: ${label(a.roomType)}.`,
    `Surfaces: ${surfaces.length > 0 ? surfaces.join("; ") : "none visible"}.`,
    `Current colors: ${colors}.`,
    `Prep: ${prep.length > 0 ? prep.join(", ") : "none"}.`,
    `Floor area: ${Math.round(a.estimatedFloorSqFt)} sq ft. Ceiling height: ${a.ceilingHeightFt} ft.`,
    `Notes: ${a.notes.trim()}`,
  ].join("\n");
}
