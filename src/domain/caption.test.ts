import { describe, expect, it } from "vitest";
import { renderCaption } from "./caption";
import { FIXTURE_ANALYSES } from "../../fixtures/photo-analyses";

const kitchen = FIXTURE_ANALYSES["kitchen.jpg"];

describe("renderCaption", () => {
  it("renders a fixed, readable document", () => {
    expect(renderCaption(kitchen)).toBe(
      [
        "Room: kitchen.",
        "Surfaces: cabinets in good condition (90 sq ft); ceiling in fair condition (220 sq ft); trim in fair condition (60 sq ft); walls in good condition (320 sq ft).",
        "Current colors: white, light grey.",
        "Prep: none.",
        "Floor area: 220 sq ft. Ceiling height: 9 ft.",
        "Notes: Open plan kitchen into living area with crown molding and a dropped bulkhead. Grey island cabinets.",
      ].join("\n"),
    );
  });

  it("does not depend on the order the model listed surfaces", () => {
    const reversed = { ...kitchen, surfaces: [...kitchen.surfaces].reverse() };
    expect(renderCaption(reversed)).toBe(renderCaption(kitchen));
  });

  it("names prep work and underscores in room types as words", () => {
    const caption = renderCaption(FIXTURE_ANALYSES["water-damaged-ceiling.jpg"]);
    expect(caption).toContain("Prep: patching needed, water damage.");
    expect(renderCaption(FIXTURE_ANALYSES["living-room.jpg"])).toContain("Room: living room.");
  });

  it("renders an exterior without the side, so a user correction cannot leave a stale caption", () => {
    const front = FIXTURE_ANALYSES["exterior-front.jpg"];
    expect(renderCaption(front)).toBe(
      [
        "Exterior: 2-story house with wood siding.",
        "Surfaces: deck porch in fair condition (60 sq ft); doors in fair condition (40 sq ft); siding in fair condition (520 sq ft); trim in fair condition (90 sq ft).",
        "Current colors: barn red, white.",
        "Prep: none.",
        "Notes: Painted wood shingles with white trim. The exterior stair and landing need scraping and paint.",
      ].join("\n"),
    );
    expect(renderCaption(FIXTURE_ANALYSES["exterior-back.jpg"])).toContain("Prep: mildew.");
  });
});
