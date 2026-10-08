import { sql } from "@/db/client";
import { searchPhotos } from "@/search/search";

const query = process.argv.slice(2).join(" ") || "water damaged ceiling";
const results = await searchPhotos(query, {});
console.log(`query: ${query}`);
for (const [mode, hits] of Object.entries(results)) {
  console.log(`\n${mode}`);
  for (const h of hits.slice(0, 3)) console.log(`  ${h.score.toFixed(4)}  ${h.originalName}`);
}
await sql.end();
