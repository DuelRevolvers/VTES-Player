/**
 * Batch AI simulation (phase 5).
 *
 *   npm run simulate                 -- 20 games, seed 1
 *   npm run simulate -- --games 200 --seed 7
 *   npm run simulate -- --games 50 --verbose
 *
 * Plays whole games with an AI in every seat and prints a summary. It is
 * a script, not part of the engine: it reaches into the deck builder for
 * a realistic table, which the engine itself must not do (principle 1).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { runBatch, formatSummary } from "../src/ai/batch.ts";
import { HeuristicAgent } from "../src/ai/heuristic.ts";
import { buildHandlerRegistry } from "../src/cards/effects/cards.ts";
import { buildGame, validateDecks, type DeckDef } from "../src/ui/decks.ts";
import type { Agent } from "../src/engine/agent.ts";
import type { SeatId } from "../src/engine/state.ts";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}
const VERBOSE = process.argv.includes("--verbose");

async function main() {
  const games = arg("games", 20);
  const seed = arg("seed", 1);

  const cfgPath = path.join(process.cwd(), "config", "playtest-decks.json");
  const config = JSON.parse(await readFile(cfgPath, "utf-8")) as {
    decks: DeckDef[];
    seed: number;
    maxTurns: number | null;
  };

  // Refuse to measure anything if the decks are not legal — a batch run
  // against a broken table is worse than no data.
  const check = validateDecks(config.decks);
  if (!check.ok) {
    console.error("playtest decks are invalid; not simulating:");
    if (check.unknown.length) console.error("  unknown cards:", check.unknown.join(", "));
    if (check.unsupported.length) {
      console.error("  unsupported cards:", check.unsupported.join(", "));
    }
    process.exit(1);
  }

  const registry = buildHandlerRegistry();
  const seats = config.decks.map((d) => d.seat);

  console.log(
    `simulating ${games} games, seeds ${seed}..${seed + games - 1}, ` +
      `${seats.length} seats: ${seats.join(", ")}`,
  );

  const started = Date.now();
  const summary = runBatch({
    games,
    seed,
    registry,
    buildState: (s) =>
      buildGame({ decks: config.decks, seed: s, maxTurns: config.maxTurns ?? 40 }),
    agents: (s) => {
      const out: Record<SeatId, Agent> = {};
      // Each seat gets its own tie-breaking stream, so seats are not
      // accidentally correlated — and every stream is derived from the
      // game seed, so the whole run is reproducible.
      seats.forEach((id, i) => {
        out[id] = new HeuristicAgent({ seed: s * 1000 + i });
      });
      return out;
    },
    ...(VERBOSE
      ? {
          onGame: (r, i) =>
            console.log(
              `  #${String(i + 1).padStart(4)} seed ${r.seed}  ` +
                `winner ${r.winner ?? "-"}  turns ${r.turns}  ` +
                `decisions ${r.decisions}${r.error ? `  ERROR ${r.error}` : ""}`,
            ),
        }
      : {}),
  });
  const secs = (Date.now() - started) / 1000;

  console.log();
  console.log(formatSummary(summary));
  console.log();
  console.log(`${secs.toFixed(1)}s  (${(summary.games / secs).toFixed(1)} games/sec)`);

  // A run with errors is a failing run: the point of the harness is to
  // find them, so exit non-zero for CI.
  if (summary.errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
