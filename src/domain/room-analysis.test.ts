import { describe, expect, it } from "vitest";
import { parseRoomAnalysis, roomAnalysisJsonSchema } from "./room-analysis";
import { FIXTURE_ANALYSES } from "../../fixtures/room-analyses";

const good = FIXTURE_ANALYSES["bedroom.jpg"];

describe("parseRoomAnalysis", () => {
  it("accepts well-formed model output", () => {
    expect(parseRoomAnalysis(JSON.stringify(good))).toEqual({ ok: true, analysis: good });
  });

  it.each([
    ["non-JSON text", "Sure! Here is the analysis: {", /not JSON/],
    ["a missing field", JSON.stringify({ ...good, notes: undefined }), /notes/],
    ["an unknown room type", JSON.stringify({ ...good, roomType: "garage" }), /roomType/],
    ["confidence above 1", JSON.stringify({ ...good, confidence: 1.4 }), /confidence/],
    ["negative square footage", JSON.stringify({ ...good, surfaces: [{ kind: "walls", condition: "good", estimatedSqFt: -5 }] }), /estimatedSqFt/],
    ["an unexpected extra key", JSON.stringify({ ...good, price: 900 }), /price/],
  ])("rejects %s", (_name, raw, message) => {
    const result = parseRoomAnalysis(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });

  it("derives a strict JSON schema with every field required", () => {
    expect(roomAnalysisJsonSchema).toMatchObject({ type: "object", additionalProperties: false });
    expect(roomAnalysisJsonSchema.required).toEqual(Object.keys(good));
  });

  it("validates every fixture", () => {
    for (const analysis of Object.values(FIXTURE_ANALYSES)) {
      expect(parseRoomAnalysis(JSON.stringify(analysis)).ok).toBe(true);
    }
  });
});
