/** Standard RRF constant from Cormack et al. Dampens the gap between rank 1 and rank 2. */
export const RRF_K = 60;

/**
 * Reciprocal rank fusion: score(d) = sum over lists of 1 / (k + rank).
 * Uses ranks only, so it fuses lists whose raw scores live on different scales.
 */
export function reciprocalRankFusion(lists: string[][], k = RRF_K): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
