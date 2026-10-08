import { describe, expect, it } from "vitest";
import { summarizeEstimate, type PhotoForEstimate } from "./estimate";
import { summarizeExterior, type ExteriorPhoto } from "./exterior";
import { priceExteriorSide, priceRoom } from "./pricing";
import type { ExteriorAnalysis, ExteriorSide } from "./photo-analysis";
import { FIXTURE_ANALYSES } from "../../fixtures/photo-analyses";

const fixture = (name: `exterior-${ExteriorSide}.jpg`): ExteriorAnalysis => FIXTURE_ANALYSES[name];
const ext = (id: string, side: ExteriorSide, confidence?: number): ExteriorPhoto => {
  const analysis = fixture(`exterior-${side}.jpg`);
  return { id, side, analysis: confidence === undefined ? analysis : { ...analysis, confidence } };
};
const sideCents = (side: ExteriorSide) => priceExteriorSide(fixture(`exterior-${side}.jpg`)).totalCents;
const sideGallons = (side: ExteriorSide) => priceExteriorSide(fixture(`exterior-${side}.jpg`)).gallons;

const bedroom = FIXTURE_ANALYSES["bedroom.jpg"];
const bedroomCents = priceRoom(bedroom).totalCents;

const allSides = [ext("f", "front"), ext("b", "back"), ext("l", "left"), ext("r", "right")];

describe("summarizeExterior", () => {
  it("prices a lone front, counts it provisionally, and still asks for a decision", () => {
    const s = summarizeExterior("undecided", [ext("f", "front")]);
    expect(s.status).toBe("needs_decision");
    expect(s.sides).toEqual([{ side: "front", photoId: "f", price: priceExteriorSide(fixture("exterior-front.jpg")) }]);
    expect(s.subtotalCents).toBe(sideCents("front"));
    expect(s.missingSides).toEqual([]);
    expect(s.countedSides).toEqual(["front"]);
    expect(s.countedCents).toBe(sideCents("front"));
    expect(s.blocksCompletion).toBe(true);
  });

  it("counts only the front while undecided, pricing the other sides without counting them", () => {
    const s = summarizeExterior("undecided", [ext("b", "back"), ext("f", "front")]);
    expect(s.subtotalCents).toBe(sideCents("front") + sideCents("back"));
    expect(s.countedSides).toEqual(["front"]);
    expect(s.excludedSides).toEqual(["back"]);
    expect(s.countedCents).toBe(sideCents("front"));
    expect(s.countedGallons).toBe(sideGallons("front"));
  });

  it("counts nothing while undecided without a front photo", () => {
    const s = summarizeExterior("undecided", [ext("b", "back")]);
    expect(s.status).toBe("needs_decision");
    expect(s.countedSides).toEqual([]);
    expect(s.excludedSides).toEqual(["back"]);
    expect(s.countedCents).toBe(0);
    expect(s.countedGallons).toBe(0);
  });

  it("counts a single side once the user chooses it", () => {
    const s = summarizeExterior("single_side", [ext("f", "front")]);
    expect(s.status).toBe("single_side_priced");
    expect(s.countedCents).toBe(sideCents("front"));
    expect(s.blocksCompletion).toBe(false);
  });

  it("is incomplete with two of four sides, lists the missing ones, and stays out of the total", () => {
    const s = summarizeExterior("whole_exterior", [ext("f", "front"), ext("l", "left")]);
    expect(s.status).toBe("incomplete");
    expect(s.coveredSides).toEqual(["front", "left"]);
    expect(s.missingSides).toEqual(["back", "right"]);
    expect(s.countedSides).toEqual([]);
    expect(s.excludedSides).toEqual(["front", "left"]);
    expect(s.countedCents).toBe(0);
    expect(s.countedGallons).toBe(0);
    expect(s.blocksCompletion).toBe(true);
  });

  it("is complete and counted with all four sides", () => {
    const s = summarizeExterior("whole_exterior", allSides);
    expect(s.status).toBe("complete");
    expect(s.missingSides).toEqual([]);
    expect(s.countedSides).toEqual(["front", "back", "left", "right"]);
    expect(s.countedCents).toBe(sideCents("front") + sideCents("back") + sideCents("left") + sideCents("right"));
    expect(s.blocksCompletion).toBe(false);
  });

  it("asks for every side when the whole exterior is chosen before any upload", () => {
    const s = summarizeExterior("whole_exterior", []);
    expect(s.status).toBe("incomplete");
    expect(s.missingSides).toEqual(["front", "back", "left", "right"]);
  });

  it("has nothing to say about a home with no exterior photos", () => {
    expect(summarizeExterior("undecided", []).status).toBe("none");
    expect(summarizeExterior("single_side", []).status).toBe("none");
  });

  it("prices a duplicated side once, choosing the higher confidence photo whatever the order", () => {
    for (const photos of [
      [ext("low", "front", 0.3), ext("high", "front", 0.9)],
      [ext("high", "front", 0.9), ext("low", "front", 0.3)],
    ]) {
      const s = summarizeExterior("single_side", photos);
      expect(s.sides.map((x) => x.photoId)).toEqual(["high"]);
      expect(s.subtotalCents).toBe(sideCents("front"));
      expect(s.duplicates).toEqual([{ photoId: "low", side: "front", pricedPhotoId: "high" }]);
    }
  });

  it("breaks a confidence tie by upload order, so estimates built from the same uploads price the same photo", () => {
    const asFront = (id: string, side: ExteriorSide): ExteriorPhoto => ({ ...ext(id, side, 0.9), side: "front" });
    const firstHome = summarizeExterior("single_side", [asFront("b-left", "left"), asFront("a-back", "back")]);
    const secondHome = summarizeExterior("single_side", [asFront("a-left", "left"), asFront("b-back", "back")]);
    expect(firstHome.sides[0].photoId).toBe("b-left");
    expect(secondHome.sides[0].photoId).toBe("a-left");
    expect(firstHome.subtotalCents).toBe(sideCents("left"));
    expect(secondHome.subtotalCents).toBe(firstHome.subtotalCents);
  });
});

const analyzedExt = (p: ExteriorPhoto): PhotoForEstimate => ({ ...p, status: "analyzed" });

describe("summarizeEstimate", () => {
  it("totals rooms and counts pending and failed photos without pricing them", () => {
    const s = summarizeEstimate(
      [
        { id: "a", status: "analyzed", analysis: bedroom },
        { id: "b", status: "analyzed", analysis: bedroom },
        { id: "c", status: "queued", analysis: null },
        { id: "d", status: "analyzing", analysis: null },
        { id: "e", status: "failed", analysis: null },
      ],
      "undecided",
    );
    expect(s.rooms.map((r) => r.id)).toEqual(["a", "b"]);
    expect(s.totalCents).toBe(2 * bedroomCents);
    expect(s.pendingCount).toBe(2);
    expect(s.failedCount).toBe(1);
    expect(s.complete).toBe(false);
  });

  it("adds a chosen single side to the interior total", () => {
    const s = summarizeEstimate([{ id: "a", status: "analyzed", analysis: bedroom }, analyzedExt(ext("f", "front"))], "single_side");
    expect(s.interiorCents).toBe(bedroomCents);
    expect(s.totalCents).toBe(bedroomCents + sideCents("front"));
    expect(s.complete).toBe(true);
  });

  it("leaves an incomplete whole exterior out of the total and marks the estimate incomplete", () => {
    const s = summarizeEstimate([{ id: "a", status: "analyzed", analysis: bedroom }, analyzedExt(ext("f", "front"))], "whole_exterior");
    expect(s.totalCents).toBe(bedroomCents);
    expect(s.gallons).toBe(priceRoom(bedroom).gallons);
    expect(s.complete).toBe(false);
  });

  it("adds only the front to the total while undecided, and stays incomplete until the scope is chosen", () => {
    const s = summarizeEstimate(
      [{ id: "a", status: "analyzed", analysis: bedroom }, analyzedExt(ext("f", "front")), analyzedExt(ext("b", "back"))],
      "undecided",
    );
    expect(s.totalCents).toBe(bedroomCents + sideCents("front"));
    expect(s.gallons).toBe(priceRoom(bedroom).gallons + sideGallons("front"));
    expect(s.complete).toBe(false);
  });

  it("adds nothing from the exterior while undecided without a front photo", () => {
    const s = summarizeEstimate([{ id: "a", status: "analyzed", analysis: bedroom }, analyzedExt(ext("b", "back"))], "undecided");
    expect(s.totalCents).toBe(bedroomCents);
    expect(s.gallons).toBe(priceRoom(bedroom).gallons);
    expect(s.complete).toBe(false);
  });

  it("is complete with a whole exterior and no interior", () => {
    const s = summarizeEstimate(allSides.map(analyzedExt), "whole_exterior");
    expect(s.complete).toBe(true);
    expect(s.totalCents).toBe(s.exterior.subtotalCents);
  });

  it("is never complete when empty", () => {
    expect(summarizeEstimate([], "undecided").complete).toBe(false);
  });
});
