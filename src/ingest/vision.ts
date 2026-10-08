import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { parsePhotoAnalysis, photoAnalysisJsonSchema, type PhotoAnalysis } from "@/domain/photo-analysis";

/** `retryable` decides whether the queue should try again or fail the photo now. */
export class VisionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "VisionError";
  }
}

/** `provider` is the backend OpenRouter routed to, when the reply names one. */
export type VisionResult = { analysis: PhotoAnalysis; model: string; provider?: string };

const SYSTEM_PROMPT = `You are an estimator for a house painting company.
Look at one photo and extract facts a painter needs to quote the job. Do not price anything.
First decide the kind. "interior" is one room inside a home. "exterior" is the outside of a house, seen from one side.
Estimate paintable square footage per surface kind for what is visible. Only list surface kinds you can see.
Interior: exclude tile, glass, mirrors, and stone.
Exterior: exclude windows, roofing, masonry foundations, and unpainted brick or stone. Count only the one side facing the camera.
For an exterior, sideGuess is only a guess; the user confirms it. The front faces the street and has the main entry or garage.
If the photo is neither, use kind "interior", roomType "other", an empty surfaces list, and confidence below 0.2.`;

const { $schema: _ignored, ...schema } = photoAnalysisJsonSchema;

function config() {
  return {
    apiKey: process.env.OPENROUTER_API_KEY?.trim(),
    baseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    model: process.env.VISION_MODEL ?? "google/gemini-3.1-flash-lite",
    fallbacks: (process.env.VISION_FALLBACK_MODELS ?? "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean),
  };
}

/** Downscale before upload: the model does not need 12 MP, and tokens cost money. */
export async function toDataUrl(imagePath: string): Promise<string> {
  const jpeg = await sharp(await readFile(imagePath))
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

export async function analyzePhoto(imagePath: string): Promise<VisionResult> {
  const { apiKey, baseUrl, model, fallbacks } = config();
  if (!apiKey) {
    throw new VisionError("OPENROUTER_API_KEY is not set. Add it to .env.local and restart the worker.", false);
  }

  const body = {
    model,
    models: [model, ...fallbacks],
    temperature: 0,
    max_tokens: 4096,
    provider: { require_parameters: true },
    response_format: {
      type: "json_schema",
      json_schema: { name: "photo_analysis", strict: true, schema },
    },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Analyze this photo for a paint estimate." },
          { type: "image_url", image_url: { url: await toDataUrl(imagePath) } },
        ],
      },
    ],
  };

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Paint Estimator paint estimate POC",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new VisionError(`Could not reach OpenRouter: ${(err as Error).message}`, true);
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new VisionError(`OpenRouter returned ${response.status}: ${detail}`, retryable);
  }

  const payload = (await response.json()) as {
    model?: string;
    provider?: string;
    choices?: { finish_reason?: string; message?: { content?: string | null } }[];
  };
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  if (!content) throw new VisionError("OpenRouter response had no message content", true);

  const parsed = parsePhotoAnalysis(content);
  if (!parsed.ok) {
    throw new VisionError(`${parsed.error} (finish_reason=${choice.finish_reason}, ${content.length} chars)`, true);
  }
  return { analysis: parsed.analysis, model: payload.model ?? model, provider: payload.provider };
}
