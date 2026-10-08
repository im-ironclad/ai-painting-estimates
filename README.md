# Paint Estimator estimates

Upload one photo per room of a home. A vision model extracts the paintable surfaces, their condition, and the prep work. Code prices each room from that extraction, and the rooms add up to a whole-home estimate. A search page runs semantic search over every analyzed photo three ways: caption embeddings, CLIP image embeddings, and a hybrid of both.

This is a proof of concept. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) follows a photo through the system. [docs/CONCEPTS.md](docs/CONCEPTS.md) explains the ideas behind it and answers likely interview questions.

## Stack

- Next.js 16 App Router, TypeScript, ShadCN UI, pnpm.
- Postgres 17 with pgvector, through Drizzle ORM and drizzle-kit migrations.
- Redis and BullMQ for the analysis queue. The worker is a separate Node process.
- OpenRouter for the vision call, with structured outputs. Zod validates the response.
- transformers.js for local embeddings: `all-MiniLM-L6-v2` for captions and `clip-vit-base-patch32` for images.
- Vitest for the pricing, schema, caption, and rank-fusion tests.

## Run it

You need Node 22 or later, pnpm, and Docker.

1. Install dependencies.

   ```sh
   pnpm install
   ```

2. Create the env file, then set `OPENROUTER_API_KEY` in it.

   ```sh
   cp .env.example .env.local
   ```

3. Start Postgres on port 5434 and Redis on port 6380, then apply the migrations.

   ```sh
   pnpm db:up
   pnpm db:migrate
   ```

4. Start the web app and the worker in two terminals. On its first start, the worker downloads both embedding models (about 700 MB) into `node_modules/@huggingface/transformers/.cache`.

   ```sh
   pnpm dev
   pnpm worker
   ```

5. Open http://localhost:3100, create a home, and upload photos from `samples/`.

The web app runs on port 3100. Set `PORT` to use another port.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Starts Next.js in dev mode. |
| `pnpm worker` | Starts the BullMQ worker that analyzes photos. |
| `pnpm test` | Runs the Vitest suite. |
| `pnpm typecheck` | Generates route types, then runs `tsc`. |
| `pnpm lint` | Runs ESLint. |
| `pnpm build` | Builds the production app. |
| `pnpm db:up` | Starts Postgres and Redis with Docker Compose and waits for health checks. |
| `pnpm db:generate` | Generates a migration from `src/db/schema.ts`. |
| `pnpm db:migrate` | Applies migrations in `drizzle/`. |
| `pnpm seed:fixtures` | Ingests every sample photo with hand-written analyses instead of the vision call. No API key needed. |
| `pnpm verify:live` | Ingests every sample photo through the real OpenRouter call and scores the output against the fixture labels. |
| `pnpm run search:cli "<query>"` | Prints the top three results for each search mode. |

`search` is a pnpm built-in command, so the search script needs `pnpm run`.

## Prove the live OpenRouter path

```sh
pnpm verify:live
```

The script stores each sample photo under a new "Live OpenRouter check" home and runs the same `ingestPhoto` function the worker runs. For each photo it prints the latency, the model that answered, the room type, prep-flag agreement, confidence, and the room price. It exits with code 1 if any photo fails.

A run on 2026-10-08 analyzed all six samples with `google/gemini-3.1-flash-lite`. Each photo took 1.8 to 12.8 seconds end to end. Room type matched the fixture labels on 5 of 6 photos, and prep flags matched on 5 of 6.

## Test without an API key

`pnpm seed:fixtures` stores the six sample photos and analyzes them with hand-written `RoomAnalysis` objects from `fixtures/room-analyses.ts`. Everything after the vision call is the production code path: captions, both embeddings, pricing, and search. The seeded home is named "Fixture home (hand-written analyses, not model output)" so nobody mistakes it for model output.

With no key, the worker fails each photo on its first attempt with "OPENROUTER_API_KEY is not set. Add it to .env.local and restart the worker." The estimate page shows the error and a **Retry** button.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | none | Postgres connection string. |
| `REDIS_URL` | `redis://localhost:6380` | Redis for BullMQ. |
| `UPLOAD_DIR` | `./uploads` | Where uploaded photos are written. |
| `OPENROUTER_API_KEY` | none | Required for analysis. |
| `VISION_MODEL` | `google/gemini-3.1-flash-lite` | Primary vision model. |
| `VISION_FALLBACK_MODELS` | none | Comma-separated models OpenRouter tries if the primary fails. `.env.example` sets `openai/gpt-5-mini`. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Override for tests or a proxy. |
| `WORKER_CONCURRENCY` | `4` | Jobs the worker runs at once. |

## Sample photos

`samples/` holds six room photos from Wikimedia Commons. [samples/ATTRIBUTION.md](samples/ATTRIBUTION.md) lists each source and license.
