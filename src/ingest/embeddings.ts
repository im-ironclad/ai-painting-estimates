import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  pipeline,
  RawImage,
  type FeatureExtractionPipeline,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type Processor,
} from "@huggingface/transformers";

export const CAPTION_MODEL = "Xenova/all-MiniLM-L6-v2";
export const CLIP_MODEL = "Xenova/clip-vit-base-patch32";

type Clip = {
  processor: Processor;
  vision: PreTrainedModel;
  tokenizer: PreTrainedTokenizer;
  text: PreTrainedModel;
};

const cache = globalThis as unknown as {
  captionModel?: Promise<FeatureExtractionPipeline>;
  clipModel?: Promise<Clip>;
};

function captionModel() {
  cache.captionModel ??= pipeline("feature-extraction", CAPTION_MODEL, { dtype: "fp32" });
  return cache.captionModel;
}

function clipModel() {
  cache.clipModel ??= (async () => ({
    processor: await AutoProcessor.from_pretrained(CLIP_MODEL),
    vision: await CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL, { dtype: "fp32" }),
    tokenizer: await AutoTokenizer.from_pretrained(CLIP_MODEL),
    text: await CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL, { dtype: "fp32" }),
  }))();
  return cache.clipModel;
}

/** Loads both models up front so the first job or query does not pay the download. */
export async function warmEmbeddingModels(): Promise<void> {
  await Promise.all([captionModel(), clipModel()]);
}

/** Sentence embedding of the canonical caption. Mean-pooled and L2-normalized, 384 dims. */
export async function embedCaption(text: string): Promise<number[]> {
  const model = await captionModel();
  const output = await model(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

/** CLIP image embedding of the raw photo. L2-normalized, 512 dims. */
export async function embedImage(imagePath: string): Promise<number[]> {
  const clip = await clipModel();
  const image = await RawImage.read(imagePath);
  const { image_embeds } = await clip.vision(await clip.processor(image));
  return Array.from(image_embeds.normalize(2, -1).data as Float32Array);
}

/** CLIP text embedding, in the same space as embedImage. Used for search queries. */
export async function embedClipText(text: string): Promise<number[]> {
  const clip = await clipModel();
  const inputs = clip.tokenizer([text], { padding: true, truncation: true });
  const { text_embeds } = await clip.text(inputs);
  return Array.from(text_embeds.normalize(2, -1).data as Float32Array);
}
