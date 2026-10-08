# Concepts

This document explains the ideas the proof of concept rests on. Each section ties the idea to the file that uses it. The last section lists likely interview questions with short answers.

## Embeddings

An embedding model maps an input to a fixed-length list of numbers. Inputs with similar meaning land close together. "Peeling paint on the ceiling" and "water stain overhead" share few words but produce nearby vectors.

This project uses two models, both run locally with transformers.js in `src/ingest/embeddings.ts`.

- `all-MiniLM-L6-v2` maps text to 384 numbers. It embeds the caption of each photo and the text of each query.
- `clip-vit-base-patch32` has two encoders, one for images and one for text. Both map into the same 512-number space. It embeds the raw photo, and it embeds the query with the text encoder.

Both run on the CPU inside the Node process. Neither needs an API key or a network call after the first download.

## Cosine distance

Cosine similarity measures the angle between two vectors and ignores their length. Two vectors pointing the same way score 1. Unrelated vectors score near 0. Cosine distance is `1 - similarity`, so lower is closer.

Every vector here is normalized to length 1 before it is stored. For unit vectors, cosine distance and Euclidean distance rank results in the same order, and the inner product equals the cosine similarity.

Raw scores are only comparable within one model. In this project, a good CLIP match sits around 0.68 to 0.80 distance, while a good caption match sits around 0.45. CLIP text and image vectors never get very close to each other, because the two encoders cluster in different regions of the shared space. This is called the modality gap. Rank still works. Absolute thresholds do not transfer between models.

## pgvector operators

pgvector adds a `vector(n)` column type and three distance operators.

| Operator | Distance | Index opclass |
| --- | --- | --- |
| `<->` | Euclidean (L2) | `vector_l2_ops` |
| `<=>` | Cosine | `vector_cosine_ops` |
| `<#>` | Negative inner product | `vector_ip_ops` |

The operator in `ORDER BY` must match the opclass of the index, or Postgres does a full scan. `src/db/schema.ts` creates both HNSW indexes with `vector_cosine_ops`, and `src/search/search.ts` orders by `<=>`.

`<#>` returns the negative inner product so that ascending order puts the best match first.

## HNSW versus IVFFlat

Both are approximate nearest-neighbor indexes. They trade a little recall for a large speedup.

HNSW builds a layered graph. A query enters at the sparse top layer and walks toward closer neighbors, then drops a layer and repeats. It has good recall without tuning, works on an empty table, and handles inserts at any time. It costs more memory and builds more slowly.

IVFFlat clusters the vectors into `lists` buckets with k-means. A query searches only the `probes` nearest buckets. It builds fast and uses less memory. The clusters come from the data present at build time, so you build it after loading data and rebuild it when the distribution shifts.

This project uses HNSW. Photos arrive one at a time into an empty table, which is the case IVFFlat handles worst.

Filters interact badly with both. The index returns its top `ef_search` candidates (40 by default), and then the `WHERE` clause removes the ones that do not match. A filter that keeps 5% of rows can leave two results. pgvector 0.8 added iterative scans. `SET LOCAL hnsw.iterative_scan = relaxed_order` tells the index to keep walking until enough rows survive the filter. `src/search/search.ts` sets it in each search transaction.

## Caption embeddings versus CLIP

The two modes see different things.

The caption path embeds `renderCaption(analysis)`, the text in `src/domain/caption.ts`. It knows only what the vision model extracted: room type, surfaces, conditions, colors, prep flags, and notes. It is good at painting concepts the model was asked about, such as "needs patching" or "poor condition". It is blind to everything else in the photo.

The CLIP path embeds the pixels. It sees furniture, flowers, a person on a sofa, and lighting. It knows nothing about painting, and it never sees the extraction.

Results from `pnpm run search:cli` on the fixture seed show both effects.

| Query | Caption top hit | CLIP top hit |
| --- | --- | --- |
| peeling paint on a water damaged ceiling | water-damaged-ceiling (0.458) | water-damaged-ceiling (0.682) |
| modern kitchen with grey cabinets | kitchen | kitchen |
| orange flowers in a vase | living-room-rural (0.883), wrong | kitchen (0.805), right |
| room that needs patching before painting | water-damaged-ceiling, then living-room-rural | water-damaged-ceiling |

The flowers query is the clearest case. The flowers sit on the kitchen counter. No caption mentions them, so the caption mode returns noise, and CLIP finds the kitchen first.

A caption is also only as good as its schema. To make captions find flowers, you would add a free-text "notable objects" field to `RoomAnalysis`. That is a product decision about what the search is for.

## Hybrid search and reciprocal rank fusion

Hybrid search runs both modes and merges the lists. The two distances live on different scales, so averaging them is meaningless. Reciprocal rank fusion (RRF) uses rank only.

```
score(photo) = sum over lists of 1 / (k + rank in that list)
```

`k = 60` comes from the original paper by Cormack, Clarke, and Büttcher (2009). A larger `k` flattens the difference between rank 1 and rank 5. `src/search/rrf.ts` implements it in a few lines, and `src/search/rrf.test.ts` tests it.

RRF rewards agreement. A photo ranked third in both lists beats one ranked first in one list and last in the other. That is usually what you want. It fails when one mode is right and the other is confidently wrong. With six photos, "orange flowers in a vase" puts the rural living room first in hybrid, because caption ranked it first and CLIP ranked it in the middle. With more data and a tuned per-mode weight, the right answer has a better chance. Treat RRF as a robust default, not a guarantee.

## Structured outputs and Zod

Structured outputs constrain the model's decoder to emit JSON that matches a schema. `src/ingest/vision.ts` sends `response_format: { type: "json_schema", json_schema: { strict: true, schema } }`. The schema is `z.toJSONSchema(RoomAnalysis)`.

Zod still validates the reply with `parseRoomAnalysis`. There are three reasons.

1. Not every provider enforces every JSON Schema keyword. Some ignore `minimum` and `maximum`.
2. A fallback model might support JSON mode without strict schemas.
3. The reply crosses a trust boundary. Code past `parseRoomAnalysis` trusts the type, so the check belongs at the boundary.

`provider: { require_parameters: true }` tells OpenRouter to route only to providers that support every parameter in the request, including `response_format`. Without it, OpenRouter may route to a provider that ignores the schema.

One schema yields four things: the JSON Schema for the model, the TypeScript type, the database column type, and the validator. Adding a field means changing one file.

## The model extracts and code prices

The model never produces a price. It reports observations: surface kinds, square footage, condition, and prep flags. `priceRoom` in `src/domain/pricing.ts` turns them into gallons and dollars.

- Prices are deterministic and auditable. Each line item shows quantity, unit price, and total.
- Rates change without touching the prompt. `DEFAULT_RATES` is one object.
- Tests pin the arithmetic. `src/domain/pricing.test.ts` asserts exact line items and totals.
- A wrong price traces to either a wrong observation or a wrong rate, never to "the model felt like it".

Models are bad at arithmetic and good at perception. This split gives each side the job it does well.

## Queues

A queue moves slow, failure-prone work out of the request. The upload returns in milliseconds. The worker spends seconds on the model call and can fail without losing the photo.

**Retries.** Each job gets three attempts (`MAX_ATTEMPTS` in `src/ingest/queue.ts`). The photo shows "Attempt failed, retrying: ..." between attempts and moves to `failed` only after the last one.

**Backoff.** Retries wait 2 seconds, then 4 seconds. Exponential backoff gives a rate-limited or overloaded provider time to recover, so a burst of retries does not make the outage worse. Add jitter at scale so many failed jobs do not retry in lockstep.

**Idempotency.** A job can run twice: a worker crashes after the model call but before acking, or a user double-clicks upload. Three things make a repeat harmless. `jobId = photoId` stops duplicate jobs. The conditional claim (`WHERE status IN ('queued', 'analyzing')`) makes a job for an already analyzed photo exit as `skipped`. The final write is a full overwrite, so applying it twice gives the same row.

**Retryable versus permanent errors.** A retry helps only if the next attempt can succeed. A missing API key, a 400, or a 402 out-of-credits error fails the same way every time. `VisionError.retryable` is `false` for those, and the worker throws BullMQ's `UnrecoverableError` to skip the remaining attempts.

**Concurrency.** `WORKER_CONCURRENCY` (default 4) sets how many jobs one worker process runs at once. The model call is I/O-bound, so several jobs overlap well. The CLIP image embedding is CPU-bound and competes for the event loop.

**Rate limits.** The worker's `limiter: { max: 10, duration: 1000 }` caps job starts at 10 per second across every worker on the queue. It keeps the system under the provider's rate limit instead of reacting to 429 responses.

**Stalled jobs.** A worker holds a lock on each active job and renews it. If the worker dies, the lock expires and BullMQ hands the job to another worker. The claim accepts `analyzing` for this reason.

## OpenRouter routing and fallbacks

OpenRouter is one API in front of many model providers. The request in `src/ingest/vision.ts` uses two routing features.

- `models: [primary, ...fallbacks]` lists models in order. If the primary returns an error, is down, or refuses the request, OpenRouter tries the next one. The reply's `model` field says which model answered, and the worker stores it on the photo.
- `provider.require_parameters: true` restricts routing to providers that honor the structured-output schema.

The primary is `google/gemini-3.1-flash-lite`. I chose it from OpenRouter's model list because it accepts images, supports structured outputs, and is one of the cheapest vision models there at $0.25 per million input tokens and $1.50 per million output tokens. The fallback, `openai/gpt-5-mini`, is from a different provider family, so one provider's outage does not take both down.

`max_tokens` is capped at 4096. Without a cap, OpenRouter reserves the model's full output window against the key's credit limit. A low-balance key then gets a 402 even though the reply needs about 250 tokens. The first live run hit exactly this error.

## Cost and latency

Measured on 2026-10-08 through a logging proxy, three sample photos, `google/gemini-3.1-flash-lite`:

| Measure | Value |
| --- | --- |
| Prompt tokens | 1,906 to 1,934 (image resized to 1024 px, plus system prompt and schema) |
| Completion tokens | 180 to 282 |
| Cost per photo | $0.00075 to $0.00090 |
| Latency per call | 4.2 to 7.2 seconds |

A ten-room home costs under one cent to analyze. Across all live runs, end-to-end ingestion took 1.8 to 12.8 seconds per photo. Most of that variance is provider latency.

The levers, in order of effect:

1. Image size. `toDataUrl` resizes to 1024 px before upload. A 12-megapixel phone photo would cost several times more and gain nothing for this task.
2. Model choice. Larger vision models list at several times the per-token price. Use one as a fallback, not the default, unless an eval shows the cheap model is wrong too often.
3. Parallel work. The CLIP embedding runs while the model call is in flight, so it adds no latency.
4. Prompt caching. The system prompt and schema are identical on every call. Providers that cache prompt prefixes would bill them at a discount.

## Evaluating extraction quality

The fixtures in `fixtures/room-analyses.ts` double as hand-written labels. `pnpm verify:live` runs every sample through the live model and compares two fields against them.

The run on 2026-10-08 measured:

- Room type matched the labels on 5 of 6 photos. The miss was `living-room-rural.jpg`, a close-up of a plaster wall that the model called `other` with confidence 0.1. The system prompt tells the model to use `other` for a photo that is not a room interior, so the model followed the prompt.
- Prep flags matched on 5 of 6. The miss was `highCeilings` on the same close-up.
- Two runs at temperature 0 priced the bedroom at $917.50 and $1,045.00, because the square-footage estimate moved. Temperature 0 does not make a hosted model deterministic.

To take this further:

1. Build a labeled set of 50 to 200 real photos that covers each room type and condition.
2. Score categorical fields (room type, condition, prep flags) by accuracy per field, with a confusion matrix for room type.
3. Score numeric fields (square footage) by absolute percentage error against measured rooms.
4. Score the final output too. The business cares about the price error against a human estimator's quote.
5. Run the eval on every prompt change and every model change. Run each photo several times to measure variance as well as accuracy.
6. Use `confidence` to route low-confidence rooms to a human, and check that low confidence actually predicts errors.

## Chunking

Chunking splits a long document into pieces before embedding, because an embedding model has an input limit and one vector cannot represent a 40-page document well. This project does not chunk. Each photo is one unit, and each caption is a few sentences, well under MiniLM's 256-token limit. Chunking matters for long inputs such as contracts, manuals, or inspection reports.

## Likely interview questions

**Why a queue instead of calling the model in the upload request?**
The call takes several seconds and fails sometimes. A queue returns the upload at once, retries with backoff, survives a web server restart, and lets the worker scale on its own.

**What happens if a job runs twice?**
Nothing bad. `jobId = photoId` stops duplicate jobs. The conditional claim skips photos that are already terminal. The final write overwrites the same columns with the same kind of data.

**What if Redis is down when a photo is uploaded?**
The row exists as `queued` but has no job. This POC does not handle it. The fix is a sweeper that re-enqueues old `queued` rows, or a transactional outbox that writes the job to Postgres in the same transaction as the photo.

**Why validate with Zod if the model uses structured outputs?**
Providers enforce schemas unevenly, fallbacks may not enforce them, and the reply crosses a trust boundary. Validation costs microseconds.

**Why does the model not produce the price?**
Prices must be exact, explainable, and testable. Code does arithmetic perfectly. Models do it badly. The model reports what it sees, and `priceRoom` applies rates.

**Why two embeddings?**
They see different things. Captions capture the extracted painting facts. CLIP captures everything visible. On "orange flowers in a vase", CLIP finds the kitchen and the caption mode does not. On "room that needs patching before painting", the caption mode puts both photos that need patching in its top two.

**Why RRF instead of averaging scores?**
Cosine distances from two models are on different scales. RRF uses rank only, so no calibration is needed.

**Why HNSW over IVFFlat?**
Photos arrive one at a time into an initially empty table. HNSW handles inserts with no rebuild. IVFFlat needs data present at build time to choose its clusters.

**Why does filtered vector search return too few rows, and how do you fix it?**
The index returns its top candidates first and the filter runs after. Selective filters remove most of them. pgvector 0.8 iterative scans keep searching until enough rows match.

**How would you scale this to a million photos?**
Store files in S3. Run more workers. Raise the limiter to match the provider quota. Partition the HNSW index or pre-filter by tenant, since searches are per company in practice. Move embeddings to a GPU service if CPU becomes the bottleneck.

**How do you know the extraction is good?**
Today, a six-photo smoke eval against hand-written labels. For production, a labeled set scored per field, with the price error as the business metric, run on every prompt or model change.

**What does a photo cost to analyze?**
About $0.0008 with `gemini-3.1-flash-lite`, measured. Image size drives most of it.

**What happens with a bad photo, such as a blurry close-up or not a room?**
The prompt asks the model to return `other` with low confidence. The close-up sample came back as `other` with confidence 0.1. The UI should flag low-confidence rooms for review instead of silently pricing them. This POC prices them and shows the confidence.
