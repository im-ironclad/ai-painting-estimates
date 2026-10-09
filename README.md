# Paint Estimator

Upload one photo per room of a home, or one per side of the house. A vision model says whether each photo is an interior or an exterior and extracts the paintable surfaces, their condition, and the prep work. Code prices each room and each side from that extraction, and they add up to a whole-home estimate.

An exterior photo starts a decision. After the first side is priced, the page asks "Paint just this side, or the whole exterior?" Just this side counts that side in the total. Whole exterior shows a checklist with an upload slot for each missing side, and keeps the exterior out of the total until all four sides are analyzed. A search page runs semantic search over every analyzed photo three ways: caption embeddings, CLIP image embeddings, and a hybrid of both.

This is a proof of concept. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) follows a photo through the system. [docs/CONCEPTS.md](docs/CONCEPTS.md) explains the ideas behind it and answers likely interview questions.

## Stack

- Next.js 16 App Router, TypeScript, ShadCN UI, pnpm.
- Postgres 17 with pgvector, through Drizzle ORM and drizzle-kit migrations.
- Redis and BullMQ for the analysis queue. The worker is a separate Node process.
- OpenRouter for the vision call, with structured outputs. Zod validates the response.
- transformers.js for local embeddings: `all-MiniLM-L6-v2` for captions and `clip-vit-base-patch32` for images.
- Vitest for the pricing, schema, caption, estimate summary, and rank-fusion tests.

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
| `pnpm consistency` | Builds the same estimate several times from the same photos through the live model and compares the results. |
| `pnpm run search:cli "<query>"` | Prints the top three results for each search mode. |

`search` is a pnpm built-in command, so the search script needs `pnpm run`.

## Prove the live OpenRouter path

```sh
pnpm verify:live
```

The script stores each sample photo under a new "Live OpenRouter check" home with the whole-exterior scope and runs the same `ingestPhoto` function the worker runs. It retries a retryable error up to three times, as the worker does. For each photo it prints the latency, the attempt count, the model that answered, the kind, the room type or side guess, prep-flag agreement, confidence, and the price. It then prints the exterior summary. It exits with code 1 if any photo fails after its retries or comes back as the wrong kind.

The last run on 2026-10-08 analyzed all ten samples with `google/gemini-3.1-flash-lite`, each on its first attempt, in 1.9 to 12.1 seconds per photo. All ten came back as the right kind. Room type or side guess matched the fixture labels on 5 of 10, and prep flags matched on 5 of 10. The model guessed "front" for all four exterior sides, so the summary reports one covered side and three duplicates. [docs/CONCEPTS.md](docs/CONCEPTS.md) explains why the side is only a guess.

## Check that the same photos give the same estimate

```sh
pnpm consistency -- --runs 3 --set interior
```

The script creates `--runs` estimates named "Consistency run <time> <set> <n>/<runs>", stores the same sample photos in each, and runs the worker's `ingestPhoto` with the live OpenRouter call. It runs in-process, so no job goes on the BullMQ queue a running worker reads. `--set interior` uses the six room photos. `--set exterior` uploads the four exterior photos through the side slots with the whole-exterior scope, so the sides come from the user and the exterior counts in the total. The default `--set all` runs both, which is 30 calls at three runs.

It prints, per set, every estimate total and the spread. Per photo it prints the price in each run, the model and provider that answered, every analysis field whose value differs, and the priced lines it moved. Surfaces are matched by kind, so a different list order is not a difference. It writes the full result to `reports/consistency/<time>.json` and exits with code 1 when the spread exceeds `--tolerance-cents` (default 0).

`--compare <id>,<id>,...` compares estimates that already exist and makes no model call. `--concurrency` sets calls in flight (default 1, because a low-credit OpenRouter key rejects parallel calls with 402).

Run it with `VISION_PROVIDERS` and `VISION_SEED` set to see whether pinning the backend and the seed removes the variance. Unset `VISION_FALLBACK_MODELS` at the same time. The provider pin applies to every model in the list, and no Google provider serves the fallback.

```sh
VISION_PROVIDERS=google-ai-studio VISION_SEED=7 VISION_FALLBACK_MODELS= pnpm consistency
```

Two earlier `verify:live` estimates that analyzed all ten samples, compared with `--compare`, matched on 8 of 10 photos. `bathroom.jpg` listed a 60 sq ft ceiling in one run and not the other ($505.00 against $360.00), and `living-room-rural.jpg` rated the walls fair in one run and poor in the other ($368.00 against $398.00). The interior totals were $5,499.10 and $5,384.10. The model is not deterministic at temperature 0, and code cannot remove that. Code did add a second source, fixed in this branch. Two exterior photos guessed as the same side with equal confidence were broken by random photo id, so the same uploads priced different sides in different estimates.

## Test without an API key

`pnpm seed:fixtures` stores the ten sample photos and analyzes them with hand-written `PhotoAnalysis` objects from `fixtures/photo-analyses.ts`. Everything after the vision call is the production code path: captions, both embeddings, pricing, and search. The seeded home is named "Fixture home (hand-written analyses, not model output)" so nobody mistakes it for model output.

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
| `VISION_PROVIDERS` | none | Comma-separated OpenRouter provider slugs to pin, in order, with no fallback to other providers. |
| `VISION_SEED` | none | Integer seed sent with the vision call. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Override for tests or a proxy. |
| `WORKER_CONCURRENCY` | `4` | Jobs the worker runs at once. |

## Sample photos

`samples/` holds six room photos and four exterior photos from Wikimedia Commons. [samples/ATTRIBUTION.md](samples/ATTRIBUTION.md) lists each source and license. The front, left, and right photos show one house. No freely licensed rear photo of that house exists, so `exterior-back.jpg` shows a different house. The prices are still correct per side, but the four sides do not describe one real home.
