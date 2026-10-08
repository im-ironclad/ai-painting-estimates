import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { db, sql } from "@/db/client";
import { estimates } from "@/db/schema";
import { compareRuns, type Comparison, type EstimateRun, type FieldDiff } from "@/consistency/compare";
import type { ExteriorSide } from "@/domain/photo-analysis";
import { formatCents } from "@/domain/pricing";
import { ingestPhoto, isRetryable } from "@/ingest/ingest-photo";
import { storePhoto } from "@/ingest/photos";
import { MAX_ATTEMPTS } from "@/ingest/queue";
import { analyzePhoto, toDataUrl, type VisionResult } from "@/ingest/vision";
import { getEstimateView } from "@/server/estimates";

/** Exterior photos go in through the side slots, as a user filling the whole-exterior checklist would. */
const SETS = {
  interior: {
    scope: "undecided",
    photos: ["bathroom.jpg", "bedroom.jpg", "kitchen.jpg", "living-room-rural.jpg", "living-room.jpg", "water-damaged-ceiling.jpg"].map(
      (fileName) => ({ fileName, side: undefined }),
    ),
  },
  exterior: {
    scope: "whole_exterior",
    photos: (["back", "front", "left", "right"] as const).map((side) => ({ fileName: `exterior-${side}.jpg`, side })),
  },
} as const satisfies Record<string, { scope: "undecided" | "whole_exterior"; photos: { fileName: string; side?: ExteriorSide }[] }>;
type SetName = keyof typeof SETS;

const argv = process.argv.slice(2);
const { values: args } = parseArgs({
  args: argv[0] === "--" ? argv.slice(1) : argv,
  options: {
    runs: { type: "string", default: "3" },
    set: { type: "string", default: "all" },
    "tolerance-cents": { type: "string", default: "0" },
    concurrency: { type: "string", default: "1" },
    compare: { type: "string" },
  },
});
const runs = Number(args.runs);
const toleranceCents = Number(args["tolerance-cents"]);
const concurrency = Number(args.concurrency);
const setNames: SetName[] = args.set === "all" ? ["interior", "exterior"] : [args.set as SetName];
if (!Number.isInteger(runs) || runs < 2) throw new Error("--runs must be an integer of at least 2");
if (!Number.isInteger(toleranceCents) || toleranceCents < 0) throw new Error("--tolerance-cents must be a non-negative integer");
if (!setNames.every((s) => s in SETS)) throw new Error(`--set must be one of all, ${Object.keys(SETS).join(", ")}`);
if (!args.compare && !process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set in .env.local.");

const startedAt = new Date().toISOString();
let calls = 0;

/** The production analyzer, unchanged; this only remembers which backend answered each photo. */
const providers = new Map<string, string | null>();
const recording = (photoId: string) => async (imagePath: string): Promise<VisionResult> => {
  calls++;
  const result = await analyzePhoto(imagePath);
  providers.set(photoId, result.provider ?? null);
  return result;
};

/** Ingests in-process, never through the shared BullMQ queue, retrying the way the worker does. */
async function ingest(photoId: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await ingestPhoto(photoId, recording(photoId), { finalAttempt: attempt === MAX_ATTEMPTS });
      return;
    } catch (err) {
      if (!isRetryable(err) || attempt === MAX_ATTEMPTS) throw err;
      console.log(`  ${photoId} attempt ${attempt} failed, retrying: ${(err as Error).message.slice(0, 120)}`);
    }
  }
}

async function pool(tasks: (() => Promise<void>)[], size: number) {
  const queue = [...tasks];
  await Promise.all(Array.from({ length: size }, async () => {
    for (let task = queue.shift(); task; task = queue.shift()) await task();
  }));
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** Reads an estimate back through the same view the page renders. Photos are named by their upload file name. */
async function collect(estimateId: string): Promise<EstimateRun> {
  const view = await getEstimateView(estimateId);
  if (!view) throw new Error(`No estimate ${estimateId}`);
  const photos = view.photos.map((p) => {
    if (!p.analysis || !p.price) throw new Error(`${p.originalName} in ${estimateId} ended ${p.status}: ${p.error}`);
    return { fileName: p.originalName, model: p.model ?? "unknown", provider: providers.get(p.id) ?? null, analysis: p.analysis, price: p.price };
  });
  return { estimateId, totalCents: view.summary.totalCents, photos };
}

async function runSet(name: SetName) {
  const set = SETS[name];
  const created: { estimateId: string; photoIds: Map<string, string> }[] = [];
  for (let i = 1; i <= runs; i++) {
    const [estimate] = await db
      .insert(estimates)
      .values({ name: `Consistency run ${startedAt} ${name} ${i}/${runs}`, exteriorScope: set.scope })
      .returning();
    const photoIds = new Map<string, string>();
    for (const { fileName, side } of set.photos) {
      const bytes = await readFile(path.join("samples", fileName));
      photoIds.set(fileName, await storePhoto(estimate.id, { name: fileName, type: "image/jpeg", bytes }, { exteriorSide: side }));
    }
    created.push({ estimateId: estimate.id, photoIds });
  }

  await pool(created.flatMap((c) => [...c.photoIds.values()].map((id) => () => ingest(id))), concurrency);

  const estimateRuns = await Promise.all(created.map((c) => collect(c.estimateId)));

  const preprocessed = Object.fromEntries(
    await Promise.all(set.photos.map(async ({ fileName }) => {
      const hashes = await Promise.all([1, 2].map(async () => sha(await toDataUrl(path.join("samples", fileName)))));
      return [fileName, new Set(hashes).size === 1 ? hashes[0] : `UNSTABLE ${hashes.join(" ")}`];
    })),
  );

  return { estimates: estimateRuns, preprocessedImageSha256: preprocessed, comparison: compareRuns(estimateRuns, toleranceCents) };
}

const show = (v: unknown) => (v === undefined ? "absent" : JSON.stringify(v).slice(0, 48));
const diffLine = (d: FieldDiff) => `      ${d.path}: ${d.values.map(show).join(" | ")}`;

function print(name: string, c: Comparison) {
  const verdict = c.withinTolerance ? "CONSISTENT" : "INCONSISTENT";
  console.log(`\n${name}: ${verdict}  totals ${c.totalsCents.map(formatCents).join(", ")}  spread ${formatCents(c.spreadCents)} (tolerance ${formatCents(c.toleranceCents)})`);
  for (const p of c.photos) {
    const same = p.analysisDiffs.length === 0;
    const routes = [...new Set(p.routes)].join(", ");
    console.log(`  ${p.fileName.padEnd(26)} ${same ? "identical" : `${p.analysisDiffs.length} fields differ`}  ${p.totalsCents.map(formatCents).join(" | ")}  [${routes}]`);
    p.analysisDiffs.forEach((d) => console.log(diffLine(d)));
    if (p.lineItemDiffs.length) console.log(`    line items:`);
    p.lineItemDiffs.forEach((d) => console.log(diffLine(d)));
  }
}

type SetResult = { estimates: EstimateRun[]; preprocessedImageSha256?: Record<string, string>; comparison: Comparison };
const results: Record<string, SetResult> = {};
if (args.compare) {
  const runsFromDb = await Promise.all(args.compare.split(",").map((id) => collect(id.trim())));
  results.compared = { estimates: runsFromDb, comparison: compareRuns(runsFromDb, toleranceCents) };
  print("compared", results.compared.comparison);
} else {
  for (const name of setNames) {
    console.log(`${name}: ${runs} estimates x ${SETS[name].photos.length} photos`);
    results[name] = await runSet(name);
    print(name, results[name].comparison);
  }
}

const report = {
  startedAt,
  finishedAt: new Date().toISOString(),
  runs,
  toleranceCents,
  openRouterCalls: calls,
  visionModel: process.env.VISION_MODEL ?? "google/gemini-3.1-flash-lite",
  fallbackModels: process.env.VISION_FALLBACK_MODELS ?? "",
  sets: results,
};
const file = path.join("reports", "consistency", `${startedAt.replaceAll(":", "-")}.json`);
await mkdir(path.dirname(file), { recursive: true });
await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nOpenRouter calls: ${calls}. Report: ${file}`);

await sql.end();
process.exit(Object.values(results).every((r) => r.comparison.withinTolerance) ? 0 : 1);
