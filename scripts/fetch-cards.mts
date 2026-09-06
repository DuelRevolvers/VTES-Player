/**
 * Fetch the full KRCG card database snapshot to data/vtes-raw.json.
 *
 * KRCG publishes the complete card list (official VEKN data, used with
 * permission from Paradox Interactive) as JSON:
 *   https://static.krcg.org/data/vtes.json
 *
 * Run: npm run cards:fetch
 * Then: npm run cards:sets      (to see set keys and pick the V5 pool)
 * Then: npm run cards:registry  (to build src/cards/registry.json)
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const URL = "https://static.krcg.org/data/vtes.json";
const OUT = path.join(process.cwd(), "data", "vtes-raw.json");

async function main() {
  console.log(`Fetching ${URL} ...`);
  const res = await fetch(URL);
  if (!res.ok) {
    throw new Error(`KRCG fetch failed: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  // Sanity check before writing: parse and count.
  const parsed = JSON.parse(text);
  const count = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length;
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, text, "utf-8");
  console.log(`Wrote ${OUT} (${count} top-level entries, ${(text.length / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`Next: npm run cards:sets`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
