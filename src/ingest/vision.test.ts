import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_ANALYSES } from "../../fixtures/photo-analyses";
import { analyzePhoto } from "./vision";

const bedroom = path.resolve(__dirname, "../../samples/bedroom.jpg");

async function sentBody(env: Record<string, string>) {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.stubEnv("VISION_SEED", "");
  vi.stubEnv("VISION_PROVIDERS", "");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const fetchMock = vi.fn(async () =>
    Response.json({
      model: "google/gemini-3.1-flash-lite",
      provider: "Google AI Studio",
      choices: [{ message: { content: JSON.stringify({ analysis: FIXTURE_ANALYSES["bedroom.jpg"] }) } }],
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const result = await analyzePhoto(bedroom);
  const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
  return { body: JSON.parse(init.body as string), result };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("analyzePhoto request", () => {
  it("leaves routing to OpenRouter and sends no seed by default", async () => {
    const { body, result } = await sentBody({});
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body).not.toHaveProperty("seed");
    expect(result.provider).toBe("Google AI Studio");
  });

  it("pins the providers in order with no fallback, and sends the seed, when configured", async () => {
    const { body } = await sentBody({ VISION_PROVIDERS: "google-ai-studio", VISION_SEED: "7" });
    expect(body.provider).toEqual({ require_parameters: true, order: ["google-ai-studio"], allow_fallbacks: false });
    expect(body.seed).toBe(7);
  });
});
