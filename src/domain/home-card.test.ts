import { describe, expect, it } from "vitest";
import { summarizeHome, type Home } from "./home-card";
import type { PhotoForEstimate } from "./estimate";
import type { ExteriorScope } from "./exterior";
import type { ExteriorSide } from "./photo-analysis";
import { priceExteriorSide, priceRoom } from "./pricing";
import { FIXTURE_ANALYSES } from "../../fixtures/photo-analyses";

const bedroom = FIXTURE_ANALYSES["bedroom.jpg"];
const bedroomCents = priceRoom(bedroom).totalCents;
const sideCents = (side: ExteriorSide) => priceExteriorSide(FIXTURE_ANALYSES[`exterior-${side}.jpg`]).totalCents;

const home = (exteriorScope: ExteriorScope = "undecided"): Home => ({ id: "h", name: "12 Oak Street", createdAt: new Date(0), exteriorScope });
const room = (id: string): PhotoForEstimate => ({ id, status: "analyzed", analysis: bedroom });
const side = (id: string, s: ExteriorSide): PhotoForEstimate => ({ id, status: "analyzed", analysis: FIXTURE_ANALYSES[`exterior-${s}.jpg`], side: s });
const queued = (id: string): PhotoForEstimate => ({ id, status: "queued", analysis: null });
const failed = (id: string): PhotoForEstimate => ({ id, status: "failed", analysis: null });

describe("summarizeHome", () => {
  it("is complete with every room priced and totals them", () => {
    const card = summarizeHome(home(), [room("a"), room("b")]);
    expect(card.state).toEqual({ kind: "complete" });
    expect(card.totalCents).toBe(2 * bedroomCents);
    expect(card.roomCount).toBe(2);
    expect(card.thumbnailPhotoId).toBe("a");
  });

  it("reports analysis progress and totals only what is analyzed so far", () => {
    const card = summarizeHome(home(), [room("a"), queued("b"), { id: "c", status: "analyzing", analysis: null }]);
    expect(card.state).toEqual({ kind: "analyzing", analyzed: 1, total: 3 });
    expect(card.totalCents).toBe(bedroomCents);
  });

  it("puts failures ahead of analysis still running, and leaves failed photos out of the total", () => {
    const card = summarizeHome(home(), [room("a"), failed("b"), queued("c")]);
    expect(card.state).toEqual({ kind: "failed", failed: 1 });
    expect(card.totalCents).toBe(bedroomCents);
  });

  it("asks for a scope while undecided and counts only the front, like the estimate page", () => {
    const card = summarizeHome(home("undecided"), [room("a"), side("f", "front"), side("b", "back")]);
    expect(card.state).toEqual({ kind: "needs_scope" });
    expect(card.totalCents).toBe(bedroomCents + sideCents("front"));
    expect(card.countedSides).toEqual(["front"]);
    expect(card.excludedSides).toEqual(["back"]);
  });

  it("names the missing sides of an unfinished whole exterior and counts none of it", () => {
    const card = summarizeHome(home("whole_exterior"), [side("f", "front")]);
    expect(card.state).toEqual({ kind: "exterior_incomplete", missingSides: 3 });
    expect(card.totalCents).toBe(0);
  });

  it("is empty with no photos, a zero total, and no thumbnail", () => {
    const card = summarizeHome(home(), []);
    expect(card.state).toEqual({ kind: "empty" });
    expect(card.totalCents).toBe(0);
    expect(card.thumbnailPhotoId).toBeNull();
  });
});
