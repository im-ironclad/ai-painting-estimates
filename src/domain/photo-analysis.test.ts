import { describe, expect, it } from "vitest";
import { parsePhotoAnalysis, photoAnalysisJsonSchema } from "./photo-analysis";
import { FIXTURE_ANALYSES } from "../../fixtures/photo-analyses";

const interior = FIXTURE_ANALYSES["bedroom.jpg"];
const exterior = FIXTURE_ANALYSES["exterior-front.jpg"];
const reply = (analysis: unknown) => JSON.stringify({ analysis });

describe("parsePhotoAnalysis", () => {
  it("accepts a well-formed interior analysis", () => {
    expect(parsePhotoAnalysis(reply(interior))).toEqual({ ok: true, analysis: interior });
  });

  it("accepts a well-formed exterior analysis", () => {
    expect(parsePhotoAnalysis(reply(exterior))).toEqual({ ok: true, analysis: exterior });
  });

  it.each([
    ["non-JSON text", "Sure! Here is the analysis: {", /not JSON/],
    ["a bare analysis without the envelope", JSON.stringify(interior), /analysis/],
    ["a missing kind", reply({ ...interior, kind: undefined }), /kind/],
    ["an unknown kind", reply({ ...exterior, kind: "roof" }), /kind/],
    ["interior fields under the exterior kind", reply({ ...interior, kind: "exterior" }), /sideGuess/],
    ["exterior fields under the interior kind", reply({ ...exterior, kind: "interior" }), /roomType/],
    ["a missing field", reply({ ...interior, notes: undefined }), /notes/],
    ["an unknown room type", reply({ ...interior, roomType: "garage" }), /roomType/],
    ["an unknown side", reply({ ...exterior, sideGuess: "top" }), /sideGuess/],
    ["an exterior surface on an interior", reply({ ...interior, surfaces: [{ kind: "siding", condition: "good", estimatedSqFt: 5 }] }), /surfaces/],
    ["four stories", reply({ ...exterior, stories: 4 }), /stories/],
    ["confidence above 1", reply({ ...exterior, confidence: 1.4 }), /confidence/],
    ["negative square footage", reply({ ...interior, surfaces: [{ kind: "walls", condition: "good", estimatedSqFt: -5 }] }), /estimatedSqFt/],
    ["an unexpected extra key", reply({ ...exterior, price: 900 }), /price/],
  ])("rejects %s", (_name, raw, message) => {
    const result = parsePhotoAnalysis(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });

  it("derives a strict wire schema with one branch per kind and every field required", () => {
    expect(photoAnalysisJsonSchema).toMatchObject({ type: "object", additionalProperties: false, required: ["analysis"] });
    const branches = (photoAnalysisJsonSchema.properties!.analysis as { anyOf: { required: string[]; properties: { kind: unknown } }[] }).anyOf;
    expect(branches.map((b) => b.properties.kind)).toEqual([
      { type: "string", enum: ["interior"] },
      { type: "string", enum: ["exterior"] },
    ]);
    expect(branches[0].required).toEqual(Object.keys(interior));
    expect(branches[1].required).toEqual(Object.keys(exterior));
    expect(JSON.stringify(photoAnalysisJsonSchema)).not.toMatch(/"oneOf"|"const"/);
  });

  it("sends stories as an integer range, because Gemini drops the exterior branch on a numeric enum", () => {
    const exteriorBranch = (photoAnalysisJsonSchema.properties!.analysis as { anyOf: { properties: Record<string, unknown> }[] }).anyOf[1];
    expect(exteriorBranch.properties.stories).toMatchObject({ type: "integer", minimum: 1, maximum: 3 });
    expect(exteriorBranch.properties.stories).not.toHaveProperty("enum");
  });

  it("validates every fixture", () => {
    for (const analysis of Object.values(FIXTURE_ANALYSES)) {
      expect(parsePhotoAnalysis(reply(analysis)).ok).toBe(true);
    }
  });
});
