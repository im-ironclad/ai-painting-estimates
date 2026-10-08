import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "./rrf";

describe("reciprocalRankFusion", () => {
  it("rewards documents that rank well in both lists over a single first place", () => {
    const fused = reciprocalRankFusion([
      ["a", "b", "c"],
      ["b", "c", "a"],
    ]);
    expect(fused.map((f) => f.id)).toEqual(["b", "a", "c"]);
    expect(fused[0].score).toBeCloseTo(1 / 62 + 1 / 61);
  });

  it("keeps documents that appear in only one list", () => {
    expect(reciprocalRankFusion([["a"], ["z"]]).map((f) => f.id)).toEqual(["a", "z"]);
  });
});
