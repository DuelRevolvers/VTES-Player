/**
 * The fair-match harness (docs/ai-bench-design.md).
 *
 * A measuring instrument has to be measured first, and the two tests that
 * matter are the CONTROLS:
 *
 *  - the NEGATIVE control — a policy against itself must not produce a
 *    difference, or the harness is measuring the seats rather than the
 *    policies;
 *  - the POSITIVE control — a deliberately crippled policy must lose by a
 *    margin, or the harness cannot detect anything and "no difference
 *    proven" means nothing at all.
 *
 * Without the second, the first passes on a harness that always answers
 * zero. That is this project's oldest failure shape — a result that is
 * empty for the wrong reason — applied to a measurement.
 */

import { describe, expect, it } from "vitest";
import { assignment, runMatch, type PolicySpec } from "../../src/ai/bench.ts";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { preconDeck, supportedPrecons } from "../../src/ui/deckimport.ts";
import { buildGame } from "../../src/ui/decks.ts";

const registry = buildHandlerRegistry();
const precon = supportedPrecons().filter((p) => p.playable)[0]!;
const SEATS = ["A", "B", "C", "D"];
const decks = SEATS.map((s) => preconDeck(precon.set, precon.name, s)!);
const buildState = (seed: number) => buildGame({ decks, seed, maxTurns: 60 });

const baseline: PolicySpec = { name: "baseline", make: (s) => new HeuristicAgent({ seed: s }) };

describe("the policy assignment", () => {
  /**
   * THE BUG THIS PINS. The first version alternated — `[0,1,0,1]` — and
   * rotating that by one gives `[1,0,1,0]` and then `[0,1,0,1]` again, so
   * a four-seat table had only TWO distinct assignments and played each
   * twice. Half the games were exact duplicates: the same deal, the same
   * seating, the same dice. That wasted the time and, worse, told the
   * margin it had twice the sample it really had.
   */
  it("gives a distinct seating for every rotation", () => {
    for (const seats of [3, 4, 5, 6]) {
      const seen = new Set<string>();
      for (let r = 0; r < seats; r++) seen.add(assignment(r, seats).join(""));
      expect(seen.size).toBe(seats);
    }
  });

  it("sits each policy in each seat the same number of times", () => {
    for (const seats of [4, 5, 6]) {
      const timesAsZero = Array.from({ length: seats }, () => 0);
      for (let r = 0; r < seats; r++) {
        assignment(r, seats).forEach((p, i) => {
          if (p === 0) timesAsZero[i]!++;
        });
      }
      // Every seat holds policy 0 equally often — which is the whole
      // point of rotating, since your prey and predator are fixed by
      // where you sit.
      expect(new Set(timesAsZero).size).toBe(1);
    }
  });

  it("always gives both policies a seat", () => {
    for (const seats of [2, 3, 4, 5, 6]) {
      for (let r = 0; r < seats; r++) {
        const a = assignment(r, seats);
        expect(a).toContain(0);
        expect(a).toContain(1);
      }
    }
  });
});

describe("the negative control: a policy against itself", () => {
  it("finds no difference, and says so", () => {
    const summary = runMatch({
      policies: [baseline, { ...baseline, name: "same" }],
      seats: SEATS,
      deals: 6,
      seed: 1,
      buildState,
      registry,
    });
    expect(summary.errors).toBe(0);
    expect(summary.significant).toBe(false);
    // Complementary rotations cancel exactly when both sides decide
    // alike, which is the pairing working rather than a coincidence.
    expect(summary.difference).toBeCloseTo(0, 10);
  });

  it("still measures a real spread, so the margin is not fake", () => {
    // A margin of zero would make `significant` meaningless: everything
    // would clear it. The individual games really do differ; it is only
    // their MEAN that cancels.
    const summary = runMatch({
      policies: [baseline, { ...baseline, name: "same" }],
      seats: SEATS,
      deals: 6,
      seed: 1,
      buildState,
      registry,
    });
    expect(summary.margin).toBeGreaterThan(0);
  });
});

describe("the positive control: a crippled policy", () => {
  it("loses by more than the margin", () => {
    // Bleeding is how a Methuselah wins (p. 43 — you oust by taking the
    // last of your prey's pool), so a policy that refuses to bleed must
    // lose clearly. If this cannot be detected, nothing can be.
    const cannotBleed: PolicySpec = {
      name: "never bleeds",
      make: (s) =>
        new HeuristicAgent({ seed: s, weights: { bleedPrey: -100, bleedPerPoint: -100 } }),
    };
    const summary = runMatch({
      policies: [cannotBleed, baseline],
      seats: SEATS,
      deals: 8,
      seed: 1,
      buildState,
      registry,
    });
    expect(summary.errors).toBe(0);
    expect(summary.significant).toBe(true);
    // The crippled side is the one that loses — a significant difference
    // in the WRONG direction would be worse than none.
    expect(summary.difference).toBeLessThan(0);
    expect(summary.policies[0]!.meanVictoryPoints).toBeLessThan(
      summary.policies[1]!.meanVictoryPoints,
    );
  });
});

describe("what the harness reports", () => {
  it("plays one game per rotation per deal, and no more", () => {
    const summary = runMatch({
      policies: [baseline, { ...baseline, name: "same" }],
      seats: SEATS,
      deals: 5,
      seed: 1,
      buildState,
      registry,
    });
    expect(summary.games).toBe(5 * SEATS.length);
    // Every seat is scored in every game.
    expect(summary.policies[0]!.games + summary.policies[1]!.games).toBe(
      summary.games * SEATS.length,
    );
  });

  it("shows the seat bias rather than hiding it", () => {
    // The rotation cancels seat bias out of the RESULT; the numbers are
    // still reported, because a table where one seat scores twice as much
    // as another is something to know about, not something to average
    // away silently.
    const summary = runMatch({
      policies: [baseline, { ...baseline, name: "same" }],
      seats: SEATS,
      deals: 5,
      seed: 1,
      buildState,
      registry,
    });
    expect(summary.meanVictoryPointsBySeat).toHaveLength(SEATS.length);
    for (const v of summary.meanVictoryPointsBySeat) expect(v).toBeGreaterThanOrEqual(0);
  });
});
