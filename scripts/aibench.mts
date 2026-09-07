/**
 * Compare two AI policies on a fair table (docs/ai-bench-design.md).
 *
 *   npm run bench                          -- the control: A vs A
 *   npm run bench -- --deals 100
 *   npm run bench -- --weights bleedPrey=12,hunt=3
 *   npm run bench -- --precon "Hecata" --seats 5
 *
 * `--weights` builds the CHALLENGER by overriding those weights on the
 * default policy; with none given, both sides are the default policy and
 * the run is a control that must come out a dead heat.
 *
 * A mirror match: the same precon in every seat, dealt fresh, with the
 * policy assignment rotated through every seat (see src/ai/bench.ts).
 * It is a script rather than part of the AI, because it reaches into the
 * deck builder for a real table and the engine must not (principle 1).
 */

import { formatMatch, runMatch, type PolicySpec } from "../src/ai/bench.ts";
import { DEFAULT_WEIGHTS, HeuristicAgent, type Weights } from "../src/ai/heuristic.ts";
import { buildHandlerRegistry } from "../src/cards/effects/cards.ts";
import { preconDeck, supportedPrecons } from "../src/ui/deckimport.ts";
import { buildGame, validateDecks } from "../src/ui/decks.ts";

function num(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}
function str(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
}

/** `--weights bleedPrey=12,hunt=3` → a partial override, with every name
 *  checked against the real table so a typo is an error rather than a
 *  silently ignored setting.
 *
 *  `effectValue` is a table rather than a number, so one of its families
 *  is named with a dot: `--weights effectValue.bleed=5`. Same check, one
 *  level down — a typo in the family is an error too. */
function parseWeights(spec: string): Partial<Weights> {
  const out: Partial<Weights> = {};
  const effects: Partial<Record<string, number>> = {};
  for (const pair of spec.split(",")) {
    const [k, v] = pair.split("=");
    if (!k || v === undefined) throw new Error(`bad --weights entry: "${pair}"`);
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`weight "${k}" is not a number: "${v}"`);
    if (k.startsWith("effectValue.")) {
      const tag = k.slice("effectValue.".length);
      if (!(tag in DEFAULT_WEIGHTS.effectValue)) {
        const known = Object.keys(DEFAULT_WEIGHTS.effectValue).join(", ");
        throw new Error(`unknown effect family "${tag}"; known: ${known}`);
      }
      effects[tag] = n;
      continue;
    }
    if (!(k in DEFAULT_WEIGHTS)) {
      throw new Error(`unknown weight "${k}"; known: ${Object.keys(DEFAULT_WEIGHTS).join(", ")}`);
    }
    if (typeof DEFAULT_WEIGHTS[k as keyof Weights] !== "number") {
      throw new Error(`weight "${k}" is a table — name one family, e.g. "${k}.bleed=5"`);
    }
    (out as Record<string, number>)[k] = n;
  }
  if (Object.keys(effects).length > 0) {
    out.effectValue = { ...DEFAULT_WEIGHTS.effectValue, ...effects };
  }
  return out;
}

function main(): void {
  const deals = num("deals", 40);
  const seed = num("seed", 1);
  const seatCount = num("seats", 4);
  const maxTurns = num("max-turns", 60);
  const wantPrecon = str("precon");
  const weightSpec = str("weights");

  const playable = supportedPrecons().filter((p) => p.playable);
  const precon = wantPrecon
    ? playable.find((p) => p.name.toLowerCase().includes(wantPrecon.toLowerCase()))
    : playable[0];
  if (!precon) {
    console.error(`no playable precon matching "${wantPrecon ?? ""}"`);
    console.error(`available: ${playable.map((p) => p.name).join(", ")}`);
    process.exit(1);
  }

  const seats = Array.from({ length: seatCount }, (_, i) => String.fromCharCode(65 + i));
  const decks = seats.map((s) => preconDeck(precon.set, precon.name, s));
  if (decks.some((d) => d === null)) {
    console.error("could not build the precon deck");
    process.exit(1);
  }
  const deckList = decks as NonNullable<(typeof decks)[number]>[];

  // Refuse to measure against an illegal table — the simulate script's
  // own rule, and it matters more here, since the whole point is that the
  // number means something.
  const check = validateDecks(deckList);
  if (!check.ok) {
    console.error("the mirror decks are not legal; not benchmarking:");
    for (const p of check.illegalDecks) console.error(`  ${p}`);
    process.exit(1);
  }

  // BOTH sides can be overridden, and the second flag is not symmetry for
  // its own sake: the question that actually comes up is "is the new
  // DEFAULT better than the old one", which needs the baseline turned
  // back rather than the challenger turned forward.
  const againstSpec = str("against");
  const challenger: PolicySpec = weightSpec
    ? {
        name: "challenger",
        make: (s) => new HeuristicAgent({ seed: s, weights: parseWeights(weightSpec) }),
      }
    : { name: "current default", make: (s) => new HeuristicAgent({ seed: s }) };
  const baseline: PolicySpec = againstSpec
    ? {
        name: "against",
        make: (s) => new HeuristicAgent({ seed: s, weights: parseWeights(againstSpec) }),
      }
    : { name: "current default", make: (s) => new HeuristicAgent({ seed: s }) };

  console.log(
    `mirror match: ${precon.set} / ${precon.name}, ${seatCount} seats\n` +
      `${deals} deals x ${seatCount} rotations = ${deals * seatCount} games` +
      // Say which run this IS. The label read "CONTROL RUN" whenever the
      // challenger was left at its default, which was wrong the moment
      // `--against` existed — and a run labelled as its own opposite is
      // exactly the sort of thing that poisons a reading weeks later.
      (weightSpec ? `\nchallenger: ${weightSpec}` : "") +
      (againstSpec ? `\nagainst:    ${againstSpec}` : "") +
      (weightSpec || againstSpec ? "" : `\nCONTROL RUN: both sides are the default policy`),
  );

  const started = Date.now();
  const summary = runMatch({
    policies: [challenger, baseline],
    seats,
    deals,
    seed,
    registry: buildHandlerRegistry(),
    buildState: (s) => buildGame({ decks: deckList, seed: s, maxTurns }),
  });
  const secs = (Date.now() - started) / 1000;

  console.log();
  console.log(formatMatch(summary, seats));
  console.log();
  console.log(`${secs.toFixed(1)}s  (${(summary.games / secs).toFixed(1)} games/sec)`);

  // An erroring run is a failing run, the same rule `simulate` follows:
  // the harness exists to find those, not to average over them.
  if (summary.errors > 0) process.exit(1);
}

main();
