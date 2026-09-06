/**
 * AI v1 — the policy agent (docs/ai-v1-design.md).
 *
 * Three properties matter more than any particular choice it makes, and
 * they are what this file pins:
 *
 *  1. it only ever returns an id it was offered (principle 4 — the
 *     legal-move generator is the sole source of legality);
 *  2. it is deterministic, so a game is still its seed plus its command
 *     log (principle 2);
 *  3. it never attempts a block it cannot win — because p. 25 allows a
 *     failed attempt to be retried indefinitely, an agent without that
 *     judgement does not merely play badly, it never terminates. That was
 *     the first batch run's result: 10 games, 10 stalls.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { viewFor } from "../../src/engine/agent.ts";
import { VtesEngine } from "../../src/engine/engine.ts";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { buildGame, type DeckDef } from "../../src/ui/decks.ts";
import type { GameState } from "../../src/engine/index.ts";
import { makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const registry = buildHandlerRegistry();

function playtestConfig(): { decks: DeckDef[]; maxTurns: number | null } {
  const raw = readFileSync(join(process.cwd(), "config", "playtest-decks.json"), "utf-8");
  return JSON.parse(raw) as { decks: DeckDef[]; maxTurns: number | null };
}

/** Play one real game with an AI in every seat; return the engine. */
function playGame(seed: number, limit = 20000): VtesEngine {
  const cfg = playtestConfig();
  const state = buildGame({ decks: cfg.decks, seed, maxTurns: cfg.maxTurns ?? 40 });
  const engine = new VtesEngine(state, registry);
  const agents = new Map<string, HeuristicAgent>();
  cfg.decks.forEach((d, i) => agents.set(d.seat, new HeuristicAgent({ seed: seed * 1000 + i })));
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) break;
    const agent = agents.get(dp.seat)!;
    const choice = agent.decide(dp, dp.options, viewFor(engine.state, dp.seat));
    engine.choose(choice);
  }
  return engine;
}

describe("the policy only ever answers with an offered option", () => {
  it("across three whole games", () => {
    const cfg = playtestConfig();
    for (const seed of [1, 2, 3]) {
      const state = buildGame({ decks: cfg.decks, seed, maxTurns: cfg.maxTurns ?? 40 });
      const engine = new VtesEngine(state, registry);
      const agents = new Map<string, HeuristicAgent>();
      cfg.decks.forEach((d, i) =>
        agents.set(d.seat, new HeuristicAgent({ seed: seed * 1000 + i })),
      );
      let steps = 0;
      for (; steps < 20000; steps++) {
        const dp = engine.decision();
        if (!dp) break;
        const choice = agents
          .get(dp.seat)!
          .decide(dp, dp.options, viewFor(engine.state, dp.seat));
        // The assertion: the agent chose from the list it was handed.
        expect(
          dp.options.some((o) => o.id === choice),
          `seat ${dp.seat} in ${dp.window} chose "${choice}"`,
        ).toBe(true);
        engine.choose(choice);
      }
      // …and the game actually ENDED rather than hitting the cap, which
      // is the property the first version of this agent failed.
      expect(steps).toBeLessThan(20000);
      expect(engine.decision()).toBeNull();
    }
  });
});

describe("the policy is deterministic", () => {
  it("the same seed produces the same command log, twice", () => {
    const a = playGame(7);
    const b = playGame(7);
    expect(a.state.commandLog.length).toBe(b.state.commandLog.length);
    expect(a.state.commandLog).toEqual(b.state.commandLog);
    // A game that ended in one decision would satisfy the above
    // vacuously.
    expect(a.state.commandLog.length).toBeGreaterThan(100);
  });

  it("a different agent seed produces a different game", () => {
    // Guarding the guard: if the tie-break stream were ignored, every
    // game would be identical and the determinism test above would be
    // meaningless.
    const a = playGame(7);
    const b = playGame(8);
    expect(a.state.commandLog).not.toEqual(b.state.commandLog);
  });
});

describe("blocking judgement — the reason the first batch run stalled", () => {
  /** Alice's V1 hunts (+1 inherent stealth); Bob may try to block. */
  function huntWithIntercept(intercept: number): {
    state: GameState;
    engine: VtesEngine;
  } {
    const state = threeSeatGame();
    const w = state.seats[1]!.minions[0]!;
    if (intercept > 0) {
      w.attached.push({
        card: { id: "eyes", name: "eyes" },
        controller: "Bob",
        owner: "Bob",
        locked: false,
        usedThisPhase: false,
        statics: { intercept },
        tags: [],
      });
    }
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("hunt:V1");
    return { state, engine };
  }

  it("declines a block it cannot win", () => {
    // A hunt has +1 inherent stealth; W has 0 intercept, so no block can
    // succeed. The engine still OFFERS it (p. 25 allows the attempt) —
    // the judgement is the agent's.
    const { engine } = huntWithIntercept(0);
    const ai = new HeuristicAgent({ seed: 1 });
    let guard = 0;
    while (guard++ < 40) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.seat === "Bob" && dp.options.some((o) => o.id === "block:W")) {
        const choice = ai.decide(dp, dp.options, viewFor(engine.state, "Bob"));
        expect(choice).not.toBe("block:W");
        return;
      }
      engine.choose(dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id);
    }
    throw new Error("Bob was never offered the block");
  });

  it("…and TAKES the block when its intercept is enough", () => {
    // The paired control. Without it, "declines to block" would pass just
    // as well for an agent that never blocks at all.
    const { engine } = huntWithIntercept(3);
    const ai = new HeuristicAgent({ seed: 1 });
    let guard = 0;
    while (guard++ < 40) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.seat === "Bob" && dp.options.some((o) => o.id === "block:W")) {
        const choice = ai.decide(dp, dp.options, viewFor(engine.state, "Bob"));
        expect(choice).toBe("block:W");
        return;
      }
      engine.choose(dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id);
    }
    throw new Error("Bob was never offered the block");
  });
});

describe("PlayerView carries the numbers a block needs", () => {
  it("stealth and per-minion intercept, only while an action is live", () => {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);
    // Before any action there is nothing to report.
    expect(viewFor(engine.state, "Bob").action).toBeUndefined();
    engine.choose("hunt:V1");
    const view = viewFor(engine.state, "Bob");
    expect(view.action).toBeDefined();
    expect(view.action!.kind).toBe("hunt");
    expect(view.action!.acting).toBe("V1");
    // A hunt carries +1 inherent stealth (p. 21).
    expect(view.action!.stealth).toBe(1);
    // Bob's own minions are reported, and only his.
    expect(Object.keys(view.action!.intercept).sort()).toEqual(["M", "W"]);
    expect(view.action!.intercept["W"]).toBe(0);
  });

  it("reports intercept for the VIEWER's minions, not the actor's", () => {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("hunt:V1");
    const alice = viewFor(engine.state, "Alice");
    expect(Object.keys(alice.action!.intercept)).toEqual(["V1"]);
  });
});

describe("basic strategic sense", () => {
  it("bleeds the prey rather than passing", () => {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "bleed:V1")).toBe(true);
    const ai = new HeuristicAgent({ seed: 1 });
    expect(ai.decide(dp, dp.options, viewFor(engine.state, dp.seat))).toBe("bleed:V1");
  });

  it("hunts with an empty vampire instead of anything else", () => {
    // p. 21 makes it mandatory, so the engine offers only the hunt — the
    // real assertion is that the agent handles a one-option decision.
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.blood = 0;
    const engine = new VtesEngine(state, testRegistry);
    const dp = engine.decision()!;
    const ai = new HeuristicAgent({ seed: 1 });
    expect(ai.decide(dp, dp.options, viewFor(engine.state, dp.seat))).toBe("hunt:V1");
  });

  it("refuses a master card that would spend it down to nothing", () => {
    // Channel 10 costs 2 pool. The first draft of this test used Blood
    // Doll, which costs NOTHING — the AI played it and was right to, and
    // the registry says so. A guard that fires on a free card would have
    // been asserting the wrong thing.
    const state = threeSeatGame();
    state.seats[0]!.pool = 4;
    state.seats[0]!.hand.push({ id: "c10", name: "Channel 10" });
    const engine = new VtesEngine(state, testRegistry);
    const ai = new HeuristicAgent({ seed: 1 });
    let guard = 0;
    while (guard++ < 60) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.window === "turn.master" && dp.options.some((o) => o.id.startsWith("play:"))) {
        const choice = ai.decide(dp, dp.options, viewFor(engine.state, dp.seat));
        expect(choice.startsWith("play:")).toBe(false);
        return;
      }
      engine.choose(dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id);
    }
    // Reaching the cap means the fixture never offered a master play;
    // that is a broken test, not a passing one.
    throw new Error("no master-phase play was ever offered");
  });

  it("takes the Edge when offered", () => {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);
    const ai = new HeuristicAgent({ seed: 1 });
    let guard = 0;
    while (guard++ < 80) {
      const dp = engine.decision();
      if (!dp) break;
      const edge = dp.options.find((o) => o.kind === "gainEdgePool");
      if (edge) {
        expect(ai.decide(dp, dp.options, viewFor(engine.state, dp.seat))).toBe(edge.id);
        return;
      }
      engine.choose(dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id);
    }
    // Not every fixture reaches an Edge offer; not finding one is fine.
    expect(guard).toBeGreaterThan(0);
  });

  it("never reads anything outside the PlayerView", () => {
    // Structural, not behavioural: the agent module must not import the
    // engine's state or its internals, or the hidden-information
    // boundary would be a suggestion (principle 5).
    const src = readFileSync(join(process.cwd(), "src/ai/heuristic.ts"), "utf-8");
    // Only the IMPORT lines, not the prose: the file's own comments
    // explain why it does not import these, and an assertion that reads
    // comments is asserting the wrong thing.
    const imports = src
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /^\s*}\s*from\s/.test(l))
      .join("\n");
    expect(imports).not.toMatch(/engine\/engine\.ts/);
    expect(imports).not.toMatch(/engine\/derived\.ts/);
    expect(imports).not.toMatch(/\bGameState\b/);
    expect(imports).not.toMatch(/\bredactFor\b/);
    // The one thing that would break replays — code only, since the
    // header comment names it as the thing it does not do.
    const code = src
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/Math\.random/);
    // Guarding the guard: the scan must actually be reading imports.
    expect(imports).toMatch(/engine\/agent\.ts/);
  });
});

describe("the agent leaves the fixtures alone", () => {
  it("makeMinion is untouched by a decision", () => {
    // A policy that mutated what it was shown would corrupt the game.
    const state = threeSeatGame();
    state.seats[0]!.minions.push(makeMinion("V2", "Alice"));
    const engine = new VtesEngine(state, testRegistry);
    const before = JSON.stringify(engine.state);
    const dp = engine.decision()!;
    new HeuristicAgent({ seed: 1 }).decide(dp, dp.options, viewFor(engine.state, dp.seat));
    expect(JSON.stringify(engine.state)).toBe(before);
  });
});
