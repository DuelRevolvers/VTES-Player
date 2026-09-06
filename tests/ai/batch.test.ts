/**
 * Batch simulation (docs/ai-v1-design.md §4).
 *
 * The harness's job is to run many whole games headlessly and report what
 * happened — including crashes, which is why `runGame` returns an error
 * rather than throwing. A harness that fell over on the first bad game
 * would find one bug per run.
 *
 * The batch in this file is small on purpose: it is a regression that the
 * loop terminates and is reproducible, not a tuning run. `npm run
 * simulate` is where volume belongs.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatSummary, runBatch, runGame } from "../../src/ai/batch.ts";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { buildGame, type DeckDef } from "../../src/ui/decks.ts";
import type { Agent } from "../../src/engine/agent.ts";
import type { SeatId } from "../../src/engine/index.ts";
import { threeSeatGame } from "../engine/fixtures.ts";

const registry = buildHandlerRegistry();
const cfg = JSON.parse(
  readFileSync(join(process.cwd(), "config", "playtest-decks.json"), "utf-8"),
) as { decks: DeckDef[]; maxTurns: number | null };

function agentsFor(seed: number): Record<SeatId, Agent> {
  const out: Record<SeatId, Agent> = {};
  cfg.decks.forEach((d, i) => {
    out[d.seat] = new HeuristicAgent({ seed: seed * 1000 + i });
  });
  return out;
}

function batch(games: number, seed: number) {
  return runBatch({
    games,
    seed,
    registry,
    buildState: (s) => buildGame({ decks: cfg.decks, seed: s, maxTurns: cfg.maxTurns ?? 40 }),
    agents: agentsFor,
  });
}

describe("batch simulation", () => {
  it("plays 12 whole games with no errors", () => {
    const s = batch(12, 1);
    expect(s.games).toBe(12);
    // The assertion that matters: every game reached a conclusion. An
    // agent that stalls shows up here as an error, which is exactly how
    // the first version of the policy was caught.
    expect(s.errors, formatSummary(s)).toBe(0);
  });

  it("every game actually ENDS — no draws at the turn cap", () => {
    // A draw is the engine's safeguard firing, not a rule (CLAUDE.md).
    // If these games start drawing, the AI has stopped making progress.
    const s = batch(12, 1);
    expect(s.draws, formatSummary(s)).toBe(0);
    expect(s.meanTurns).toBeGreaterThan(2);
  });

  it("games end by OUSTING — the victory points add up", () => {
    // In a 3-seat game the total is 2 ousts + 1 last-standing = 3. If the
    // AI were passing its way to the cap this would be 0.
    const s = batch(8, 50);
    const totalVp = Object.values(s.meanVictoryPoints).reduce((a, b) => a + b, 0);
    expect(totalVp, formatSummary(s)).toBeCloseTo(3, 1);
  });

  it("is reproducible: the same seed gives the same results", () => {
    const a = batch(5, 99);
    const b = batch(5, 99);
    expect(a.results.map((r) => [r.winner, r.turns, r.decisions])).toEqual(
      b.results.map((r) => [r.winner, r.turns, r.decisions]),
    );
    // …and different seeds do not, or "reproducible" would be trivial.
    const c = batch(5, 500);
    expect(a.results.map((r) => r.decisions)).not.toEqual(
      c.results.map((r) => r.decisions),
    );
  });

  it("reports a crashing agent as a RESULT, not by throwing", () => {
    // The harness must survive a bad agent: finding bugs is the point.
    const rogue: Agent = {
      decide: () => "not-a-real-option-id",
    };
    const agents: Record<SeatId, Agent> = {};
    for (const s of threeSeatGame().seats) agents[s.id] = rogue;
    const r = runGame(1, threeSeatGame(), agents, registry);
    expect(r.error).toBeDefined();
    expect(r.error).toContain("not offered");
  });

  it("names the seat with no agent rather than silently substituting one", () => {
    const r = runGame(1, threeSeatGame(), {}, registry);
    expect(r.error).toContain("no agent for seat");
  });

  it("formatSummary reports errors with a reproducing seed", () => {
    const s = runBatch({
      games: 2,
      seed: 42,
      registry,
      buildState: () => threeSeatGame(),
      agents: () => ({}),
    });
    const text = formatSummary(s);
    expect(text).toContain("errors:");
    expect(text).toContain("seed 42");
  });
});
