# Architecture

This document follows one photo from upload to a priced room or side, then follows a search query to its results. Every step names the file that does it.

## The data shape comes first

Four types carry the whole system.

- `PhotoAnalysis` in `src/domain/photo-analysis.ts` is a Zod discriminated union on `kind`. An `interior` analysis has a room type, interior surfaces, and interior prep flags. An `exterior` analysis has a side guess, the siding material, stories, exterior surfaces, and exterior prep flags. It is the single source of truth for what the vision model returns. The JSON Schema sent to OpenRouter, the TypeScript type, the `jsonb` column type, and the response validator all derive from it.
- `ExteriorScope` in `src/domain/exterior.ts` is `undecided`, `single_side`, or `whole_exterior`. It is a Postgres enum column on `estimates`, and `summarizeExterior` derives everything the page shows about the exterior from it and the analyzed exterior photos.
- `photo_status` in `src/db/schema.ts` is a Postgres enum: `queued`, `analyzing`, `analyzed`, `failed`. The transition table in `src/domain/photo-status.ts` lists every legal move. No other code sets `status`.
- `Rates` in `src/domain/pricing.ts` holds every number that turns an analysis into money. `priceRoom(analysis, rates)` is a pure function.

The `photos` table holds the file path, status, attempt count, last error, the analysis, the stored exterior side, the rendered caption, and two vectors: `caption_embedding vector(384)` and `clip_embedding vector(512)`. Each vector column has an HNSW index with cosine distance.

`exterior_side` is a Postgres enum column, null for interiors. A check constraint, `photos_analyzed_exterior_has_side`, requires an analyzed photo to have a side exactly when its analysis is an exterior. Pricing reads this column, never the model's `sideGuess`.

Migration `drizzle/0002_exterior.sql` adds both enums and both columns. Before it adds the constraint, it rewrites every existing analysis to `{"kind": "interior", ...}`, because every photo stored before the union was a room. On the dev database it converted all 23 existing analyses, and every existing estimate got the default scope `undecided`.

## Ingestion lifecycle

```
browser ──POST files──▶ Next.js route ──write file, insert row──▶ Postgres (queued)
                              │
                              └──add job (jobId = photo id)──▶ Redis
                                                                 │
worker ◀──────────────────────────────────────────────────────────┘
  │ claim: queued → analyzing, attempts + 1
  │ in parallel: OpenRouter vision call, CLIP image embedding
  │ render caption from the analysis, embed it with MiniLM
  └ succeed: analyzing → analyzed, store analysis + caption + both vectors

browser polls GET /api/estimates/:id every second while any photo is pending
```

### 1. Upload

`src/components/estimate-client.tsx` posts the selected files as multipart form data to `POST /api/estimates/[id]/photos` (`src/app/api/estimates/[id]/photos/route.ts`). An upload from a side slot in the exterior checklist also sends `exteriorSide`. The route validates it and stores it on the row before analysis.

`createPhoto` in `src/ingest/photos.ts` checks the type (JPEG, PNG, or WebP) and size (15 MB at most). It writes the bytes to `UPLOAD_DIR/<uuid>.<ext>`, inserts a `photos` row with status `queued`, and adds a BullMQ job. The route returns `202 Accepted` with the new photo ids. The request never waits for the model.

Production would write to S3 instead of local disk and store the object key. The worker would read from S3. Nothing else changes, because the worker only needs a path or URL it can read.

### 2. Enqueue

`enqueuePhoto` in `src/ingest/queue.ts` adds a job with `jobId` set to the photo id. BullMQ ignores an add whose `jobId` already exists, so a double submit cannot create two jobs for one photo. Each job gets three attempts with exponential backoff that starts at 2 seconds.

The row insert and the job add are two writes to two systems. If Redis is down after the insert, the photo stays `queued` with no job. The fix is a sweeper that re-enqueues `queued` photos older than a minute, or a transactional outbox. Neither is built here.

### 3. Claim

`worker/index.ts` runs a BullMQ `Worker` with concurrency 4 and a limiter of 10 jobs per second. Each job calls `ingestPhoto` in `src/ingest/ingest-photo.ts`.

`claimPhoto` in `src/ingest/photo-repo.ts` runs one conditional `UPDATE`.

```sql
update photos set status = 'analyzing', attempts = attempts + 1
where id = $1 and status in ('queued', 'analyzing')
returning *
```

If no row comes back, the photo is already `analyzed` or `failed`, and the job exits as `skipped`. A redelivered job is therefore harmless. The claim accepts `analyzing` so that a job BullMQ marks as stalled, because its worker died mid-call, can be picked up again.

### 4. Analyze and embed

`ingestPhoto` starts two things at once.

- `analyzePhoto` in `src/ingest/vision.ts` resizes the photo to fit 1024 px, encodes it as JPEG, and posts it to OpenRouter's `/chat/completions`. The request asks for `response_format: json_schema` with `strict: true` and the schema from `PhotoAnalysis`. `parsePhotoAnalysis` validates the reply with Zod before anything trusts it.
- `embedImage` in `src/ingest/embeddings.ts` runs the CLIP vision encoder locally and returns a normalized 512-dimension vector.

When both finish, `renderCaption` in `src/domain/caption.ts` turns the analysis into fixed-format text. `embedCaption` embeds that text with MiniLM into 384 dimensions.

The caption is rendered from structured fields, not written by the model. The same analysis always produces the same caption, so the caption embedding changes only when the analysis does.

### 5. Succeed or fail

On success, the `succeed` transition writes the analysis, the model name OpenRouter reports, the caption, both vectors, and `analyzed_at`. For an exterior it also sets `exterior_side` to `coalesce(exterior_side, sideGuess)`. A side the user chose at upload wins, and the model's guess fills the column only when it is empty.

On error, `ingestPhoto` picks one of two transitions.

- `failAttempt` moves the photo back to `queued` with the error "Attempt failed, retrying: ...". BullMQ retries after the backoff.
- `failFinal` moves the photo to `failed`. This happens on the third attempt, or at once if the error is not retryable.

`VisionError` in `src/ingest/vision.ts` carries a `retryable` flag. Network errors, timeouts, 408, 429, 5xx, empty replies, and replies that fail validation are retryable. A missing API key and other 4xx responses are not. The worker converts a non-retryable error into BullMQ's `UnrecoverableError`, so BullMQ does not spend the remaining attempts.

### 6. Manual retry

`POST /api/photos/[id]/retry` calls `retryPhoto` in `src/ingest/photos.ts`. The `retry` transition moves `failed` to `queued` and returns `409` for any other status. `requeuePhoto` removes the finished job and adds a fresh one with the same id, because BullMQ would ignore an add for an id it still holds.

### 7. Price and display

`GET /api/estimates/[id]` returns `getEstimateView` from `src/server/estimates.ts`. It prices each analyzed photo with `pricePhoto` at read time, which calls `priceRoom` or `priceExteriorSide` by kind. `summarizeEstimate` in `src/domain/estimate.ts` adds up analyzed rooms, calls `summarizeExterior` for the exterior, and counts pending and failed photos separately. The total includes the exterior subtotal only when the exterior status counts.

The estimate page shows the total with "N still analyzing, not in total", "N failed, not in total", and the exterior line beside it. The page polls every second while any photo is pending and stops when all are terminal.

Prices are computed on read and never stored. A rate change reprices every estimate without a migration. A real product would snapshot the rates on a quote the customer has seen.

### Exterior scope

`summarizeExterior(scope, photos)` in `src/domain/exterior.ts` is pure. It groups analyzed exterior photos by stored side, prices one photo per side, and derives a status from two tables.

| Scope | Required sides | Status | Counts in total |
| --- | --- | --- | --- |
| `undecided` or `single_side`, no exterior photo yet | none | `none` | no |
| `undecided`, at least one side | none | `needs_decision` | no |
| `single_side`, at least one side | none | `single_side_priced` | yes |
| `whole_exterior` | front, back, left, right | `incomplete` while any is missing | no |
| `whole_exterior` | front, back, left, right | `complete` | yes |

Two photos of the same side are priced once. The photo with higher confidence wins, and the smaller id breaks a tie so the pick never depends on row order. The other photo is listed as a duplicate and the page marks it.

Two routes change the inputs.

- `PATCH /api/estimates/[id]` with `{ "exteriorScope": "single_side" }` sets the scope. The scope buttons call it.
- `PATCH /api/photos/[id]` with `{ "exteriorSide": "left" }` corrects a side. It returns `409` unless the photo is an analyzed exterior. The side dropdown on each exterior card calls it.

Both return the new estimate view, so the page rerenders from the server's summary.

### Status transitions

| Event | From | To | Who triggers it |
| --- | --- | --- | --- |
| `claim` | `queued`, `analyzing` | `analyzing` | worker, at job start |
| `succeed` | `analyzing` | `analyzed` | worker |
| `failAttempt` | `analyzing` | `queued` | worker, retryable error before the last attempt |
| `failFinal` | `analyzing` | `failed` | worker, last attempt or non-retryable error |
| `retry` | `failed` | `queued` | user, through the retry route |

`transition` in `src/ingest/photo-repo.ts` turns each row into `UPDATE ... WHERE status IN (from)`. A move from the wrong state updates nothing and returns `null`. Postgres enforces the state machine, so two workers cannot both win a claim.

## Search query path

```
GET /api/search?q=...&kind=...&side=...&roomType=...&condition=...
  │ embed the query twice, in parallel: MiniLM (caption space), CLIP text encoder (image space)
  │ two nearest-neighbor queries, in parallel, each with the same filters
  │ fuse the two ranked lists with reciprocal rank fusion
  └ return { caption, clip, hybrid, tookMs }
```

1. `src/app/api/search/route.ts` validates the query string with Zod.
2. `searchPhotos` in `src/search/search.ts` embeds the query with `embedCaption` and `embedClipText`.
3. `nearest` runs one query per vector column. It orders by `<=>`, which is cosine distance, and keeps 50 candidates.
4. Filters are SQL predicates: `analysis->>'kind' = $1` for interior or exterior, `exterior_side = $1` for the stored side, `analysis->>'roomType' = $1` for room type, and `analysis->'surfaces' @> '[{"condition":"poor"}]'` for "any surface in poor condition".
5. Each query runs in a transaction with `SET LOCAL hnsw.iterative_scan = relaxed_order`. Without it, HNSW returns its first `ef_search` candidates, then the `WHERE` clause drops non-matches, and a selective filter returns too few rows.
6. `reciprocalRankFusion` in `src/search/rrf.ts` scores each photo by the sum of `1 / (60 + rank)` across both lists.
7. `src/components/search-client.tsx` shows the three lists side by side so you can compare the modes.

A warm search over the sample data takes about 20 ms, measured in `tookMs`. The first search after a server start takes about 900 ms, because it loads both text encoders.

## Process layout

| Process | Entry point | Talks to |
| --- | --- | --- |
| Web | `pnpm dev`, Next.js on port 3100 | Postgres, Redis (enqueue only), local embedding models for search queries |
| Worker | `pnpm worker`, `worker/index.ts` | Redis, Postgres, OpenRouter, local embedding models for photos |
| Postgres | `docker-compose.yml`, port 5434 | |
| Redis | `docker-compose.yml`, port 6380, `noeviction` | |

Redis runs with `maxmemory-policy noeviction`. BullMQ requires it, because an evicted key can silently lose a job.

The worker is a separate process so a slow model call never holds a web request. It also lets the worker scale on its own, and a crash in either process leaves the other running.
