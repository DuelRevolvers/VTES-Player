/**
 * List every set key found in data/vtes-raw.json with card counts.
 *
 * Purpose: we don't hardcode guesses about KRCG's set keys for the V5
 * products. Run this, eyeball the output, and copy the correct keys into
 * config/v5-sets.json. Candidates will look like "Fifth Edition",
 * "Fifth Edition (Anarch)", "New Blood", the 2023 reissue, and the 2025
 * Sabbat starters — but the authoritative spelling is whatever this prints.
 *
 * Run: npm run cards:sets
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadRawCards } from "./krcg-common.mts";

const RAW = path.join(process.cwd(), "data", "vtes-raw.json");

async function main() {
  const cards = await loadRawCards(RAW);
  const counts = new Map<string, number>();
  for (const card of cards) {
    const sets = card.sets ?? {};
    for (const key of Object.keys(sets)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`${cards.length} cards, ${sorted.length} distinct set keys:\n`);
  for (const [key, n] of sorted) {
    console.log(`${String(n).padStart(5)}  ${key}`);
  }
  console.log(
    `\nCopy the V5-product set keys into config/v5-sets.json, then run: npm run cards:registry`
  );
}

main().catch(async (err) => {
  try {
    await readFile(RAW);
    console.error(err);
  } catch {
    console.error(`Missing ${RAW} — run "npm run cards:fetch" first.`);
  }
  process.exit(1);
});
