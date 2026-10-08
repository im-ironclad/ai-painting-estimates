import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { parseRoomAnalysis, roomAnalysisJsonSchema, type RoomAnalysis } from "@/domain/room-analysis";

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

export type VisionResult = { analysis: RoomAnalysis; model: string };

const SYSTEM_PROMPT = `You are an estimator for a house painting company.
Look at one photo of one room and extract facts a painter needs to quote the job.
Estimate paintable square footage per surface kind. Exclude tile, glass, mirrors, and stone.
Only list surface kinds you can see. Do not price anything.
If the photo is not a room interior, use roomType "other", an empty surfaces list, and confidence below 0.2.`;

const { $schema: _ignored, ...schema } = roomAnalysisJsonSchema;

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
async function toDataUrl(imagePath: string): Promise<string> {
  const jpeg = await sharp(await readFile(imagePath))
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

export async function analyzeRoomPhoto(imagePath: string): Promise<VisionResult> {
  const { apiKey, baseUrl, model, fallbacks } = config();
  if (!apiKey) {
    throw new VisionError("OPENROUTER_API_KEY is not set. Add it to .env.local and restart the worker.", false);
  }

  const body = {
    model,
    models: [model, ...fallbacks],
    temperature: 0,
    provider: { require_parameters: true },
    response_format: {
      type: "json_schema",
      json_schema: { name: "room_analysis", strict: true, schema },
    },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Analyze this room for a paint estimate." },
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
    choices?: { message?: { content?: string | null } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new VisionError("OpenRouter response had no message content", true);

  const parsed = parseRoomAnalysis(content);
  if (!parsed.ok) throw new VisionError(parsed.error, true);
  return { analysis: parsed.analysis, model: payload.model ?? model };
}
