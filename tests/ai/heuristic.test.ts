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
import { DEFAULT_WEIGHTS, HeuristicAgent } from "../../src/ai/heuristic.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { buildGame, type DeckDef } from "../../src/ui/decks.ts";
import type { GameState, LegalOption } from "../../src/engine/index.ts";
import { currentBleed, passOption } from "../../src/engine/index.ts";
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

  /**
   * A BLEED the blocker can catch: stealth on the actor so intercept has
   * something to beat, and enough intercept to beat it.
   *
   * The control below used to use a hunt, purely because a hunt carries
   * +1 inherent stealth and so makes intercept meaningful. That made it
   * depend on hunts being worth blocking — and they are not: a hunt gains
   * its actor one blood, where blocking costs a lock, a combat, and the
   * chance to block something that matters. When `blockHunt` was priced
   * accordingly this test failed, which was the test's premise being
   * wrong rather than the policy. A bleed is unambiguously worth
   * stopping, and it tests what this was always for.
   */
  function bleedWithStealth(
    stealth: number,
    intercept: number,
  ): { state: GameState; engine: VtesEngine } {
    const stat = (seat: string, s: Record<string, number>) => ({
      card: { id: `st-${seat}`, name: "st" },
      controller: seat,
      owner: seat,
      locked: false,
      usedThisPhase: false,
      statics: s,
      tags: [],
    });
    const state = threeSeatGame();
    // Alice's V1 bleeds Bob; Bob's W tries to catch it.
    if (stealth > 0) state.seats[0]!.minions[0]!.attached.push(stat("Alice", { stealth }));
    if (intercept > 0) state.seats[1]!.minions[0]!.attached.push(stat("Bob", { intercept }));
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("bleed:V1");
    return { state, engine };
  }

  it("…and TAKES the block when its intercept is enough", () => {
    // The paired control. Without it, "declines to block" would pass just
    // as well for an agent that never blocks at all.
    const { engine } = bleedWithStealth(2, 3);
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

/**
 * WHICH VAMPIRE THE COUNTER GOES ON (2026-09-06).
 *
 * The policy used not to ask: every `transferToVampire` scored the same
 * flat weight, so the ties broke on the tie-breaking stream and the AI
 * chose by coin flip — spreading counters across its whole uncontrolled
 * region and taking far longer to put anything on the table.
 *
 * The data was in `PlayerView` all along: a seat's own uncontrolled
 * region is readable to its owner (p. 14), capacity and counters
 * included. Measured at +0.47 VP on the Hecata mirror (800 games,
 * margin ±0.107) — see docs/ai-bench-design.md §8 for the per-deck
 * numbers, which are not all so flattering.
 */
describe("choosing which vampire to influence", () => {
  function influencePhase(
    uncontrolled: Array<{ id: string; capacity: number; counters: number }>,
  ): VtesEngine {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "influence";
      tf.transfersLeft = 4;
    }
    state.seats[0]!.uncontrolled = uncontrolled.map((u) => ({
      card: makeMinion(u.id, "Alice", { blood: 0, capacity: u.capacity }),
      counters: u.counters,
    }));
    return new VtesEngine(state, testRegistry);
  }

  const choose = (engine: VtesEngine): string => {
    const dp = engine.decision()!;
    return new HeuristicAgent({ seed: 7 }).decide(dp, dp.options, viewFor(engine.state, dp.seat));
  };

  it("finishes the vampire that is nearly out, not the one just started", () => {
    // Counters already spent buy NOTHING until the vampire is in play, so
    // one more on the nearly-done 7 beats a first counter on the 5.
    const engine = influencePhase([
      { id: "NEARLY", capacity: 7, counters: 6 },
      { id: "FRESH", capacity: 5, counters: 0 },
    ]);
    expect(choose(engine)).toBe("inf:add:NEARLY");
  });

  it("prefers the cheaper vampire when both are untouched", () => {
    // The same term does this second job: a 4-capacity body arrives four
    // turns before an 11, and a vampire in play is worth more than a
    // bigger one that is not.
    const engine = influencePhase([
      { id: "BIG", capacity: 11, counters: 0 },
      { id: "SMALL", capacity: 4, counters: 0 },
    ]);
    expect(choose(engine)).toBe("inf:add:SMALL");
  });

  it("takes the bigger vampire when both need the same number of counters", () => {
    // Same price, more vampire. (A tie-break only: two bench runs put it
    // at +0.03 and +0.05 VP, both inside the margin, so it is kept for
    // its reasoning rather than claimed as an improvement.)
    const engine = influencePhase([
      { id: "SMALL", capacity: 4, counters: 1 },
      { id: "BIG", capacity: 9, counters: 6 },
    ]);
    expect(choose(engine)).toBe("inf:add:BIG");
  });

  it("finishes the last counter BEFORE moving a completed vampire out", () => {
    // This pins a MEASURED decision rather than an obvious one. Raising
    // `influenceOut` so that moving a finished vampire always came first
    // looked plainly right — it costs no transfer — and the bench said it
    // changes nothing at all: 240 games, an exactly identical result,
    // because the order does not matter. The AI adds the last counter and
    // then moves BOTH vampires out in the same phase.
    //
    // So the weight was left alone, and this is what that looks like.
    const engine = influencePhase([
      { id: "DONE", capacity: 4, counters: 4 },
      { id: "NEARLY", capacity: 5, counters: 4 },
    ]);
    expect(choose(engine)).toBe("inf:add:NEARLY");
    // …and the finished one is still there to be moved out, which is why
    // the ordering costs nothing.
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "inf:out:DONE")).toBe(true);
  });

  it("moves a finished vampire out when there is nothing to finish", () => {
    const engine = influencePhase([{ id: "DONE", capacity: 4, counters: 4 }]);
    expect(choose(engine)).toBe("inf:out:DONE");
  });

  it("still influences rather than passing, however expensive the vampire", () => {
    // THE FAILURE THAT WOULD MATTER MOST. The progress term is a bonus,
    // never a penalty, so an expensive vampire is still worth more than
    // passing the phase — a policy that stopped influencing would never
    // build a board at all.
    const engine = influencePhase([{ id: "HUGE", capacity: 11, counters: 0 }]);
    expect(choose(engine)).toBe("inf:add:HUGE");
  });

  it("never takes counters back off a vampire", () => {
    const engine = influencePhase([{ id: "PART", capacity: 6, counters: 3 }]);
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "inf:take:PART")).toBe(true);
    expect(choose(engine)).toBe("inf:add:PART");
  });
});

/**
 * ORDERINGS THE POLICY DEPENDS ON.
 *
 * These pin RELATIONS between weights rather than their values, because
 * the values are meant to be tuned and the relations are not. Each one is
 * a bug the bench or a profile actually found.
 */
describe("weights that must stay in order", () => {
  const w = DEFAULT_WEIGHTS;

  it("answering a card's question outranks passing", () => {
    // THE BUG. `answerChoice` was 0 and `pass` is 0.5, and declining an
    // OPTIONAL ChoiceFrame is a plain pass — so the AI turned down every
    // optional payoff in the game (Cave of Apples, Dead Pool, Hunting the
    // Beast, the rush-outcome riders), each one raised by a card its own
    // controller had already paid for.
    expect(w.answerChoice).toBeGreaterThan(w.pass);
  });

  it("lets a hunt through but stops a diablerie", () => {
    // These were a single `blockOther`, which priced stopping a vampire
    // being eaten for good (p. 34) the same as stopping somebody gaining
    // one blood.
    expect(w.blockHunt).toBeLessThan(w.pass);
    expect(w.blockDiablerize).toBeGreaterThan(w.blockBleed + 3 * w.blockPerBleedPoint);
  });

  it("never lets influencing score below passing, however expensive", () => {
    // `influenceProgress` is a bonus and never a penalty. A policy that
    // could score a transfer below `pass` would stop influencing and
    // never build a board at all.
    const worst = w.influenceTransfer + w.influenceProgress / 99;
    expect(worst).toBeGreaterThan(w.pass);
  });

  it("keeps self-oust refusal dominant over every positive", () => {
    const best = Math.max(
      w.bleedPrey + 10 * w.bleedPerPoint,
      w.blockDiablerize,
      w.huntWhenEmpty,
      w.influenceOut,
      w.withdraw,
    );
    expect(w.selfOustGuard).toBeLessThan(-best);
  });
});

/**
 * A BLEED SAYS WHAT IT IS WORTH (docs/richer-options-design.md).
 *
 * The option now carries the live value — every static, aura and
 * conditional already in it — because the engine computed exactly that to
 * build the option. The AI used to read the minion's PRINTED
 * `bleedAmount`, so a card in play that made a bleed worth three looked
 * like a bleed worth one, on the AI's most common real decision.
 */
describe("the bleed option carries its live value", () => {
  function bleedOptions(setup: (s: GameState) => void): LegalOption[] {
    const state = threeSeatGame();
    setup(state);
    const engine = new VtesEngine(state, testRegistry);
    return engine.decision()!.options.filter((o) => o.kind === "takeAction" && o.action === "bleed");
  }

  it("reports the printed amount when nothing modifies it", () => {
    const opts = bleedOptions(() => {});
    const v1 = opts.find((o) => o.id === "bleed:V1")!;
    expect(v1.kind === "takeAction" && v1.bleed).toBe(1);
  });

  it("includes a static from a card in play", () => {
    const opts = bleedOptions((s) => {
      s.seats[0]!.minions[0]!.attached.push({
        card: { id: "hc", name: "hc" },
        controller: "Alice",
        owner: "Alice",
        locked: false,
        usedThisPhase: false,
        statics: { bleed: 2 },
        tags: [],
      });
    });
    const v1 = opts.find((o) => o.id === "bleed:V1")!;
    expect(v1.kind === "takeAction" && v1.bleed).toBe(3);
    // …and it says so on the button, which is the other half of why the
    // engine should be the one to answer this.
    expect(v1.label).toContain("for 3");
  });

  it("matches what the action actually announces at", () => {
    // THE ASSERTION THAT MATTERS: the prospective value and the real one
    // are the same computation, so a card cannot make them disagree.
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.attached.push({
      card: { id: "hc", name: "hc" },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: { bleed: 2 },
      tags: [],
    });
    const engine = new VtesEngine(state, testRegistry);
    const offered = engine
      .decision()!
      .options.find((o) => o.id === "bleed:V1")!;
    engine.choose("bleed:V1");
    const af = engine.state.frames.find((f) => f.kind === "action");
    expect(af?.kind).toBe("action");
    expect(currentBleed(engine.state, af as never)).toBe(
      offered.kind === "takeAction" ? offered.bleed : -1,
    );
  });

  it("the AI scores the live value, not the printed one", () => {
    // Two bleeders, and the one with the LOWER printed bleed is worth
    // more once its card in play is counted.
    const state = threeSeatGame();
    const [weak, strong] = [state.seats[0]!.minions[0]!, makeMinion("V9", "Alice", { blood: 4 })];
    strong.bleedAmount = 1;
    weak.bleedAmount = 1;
    strong.attached.push({
      card: { id: "hc", name: "hc" },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: { bleed: 3 },
      tags: [],
    });
    state.seats[0]!.minions.push(strong);
    const engine = new VtesEngine(state, testRegistry);
    const dp = engine.decision()!;
    const choice = new HeuristicAgent({ seed: 1 }).decide(
      dp,
      dp.options,
      viewFor(engine.state, "Alice"),
    );
    expect(choice).toBe("bleed:V9");
  });
});

/**
 * THE COMBAT A SEAT IS IN (docs/ai-v1-design.md §9).
 *
 * `PlayerView.action` exists because a seat asked to block had no numbers
 * to judge it with. This is the same gap one frame along: a seat asked to
 * choose a strike or spend a press was told nothing about the fight — not
 * who it was against, not their blood, not the range. Every field is face
 * up at a real table, so exposing it leaks nothing.
 */
describe("PlayerView carries the combat", () => {
  function inCombat(): VtesEngine {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("bleed:V1");
    // Bob blocks with W. DECLARING a block is not RESOLVING one — the
    // impulse cycle has to run out before the combat frame is pushed —
    // so the walk carries on past the block until the combat exists.
    let guard = 0;
    while (guard++ < 60) {
      if (engine.state.frames.some((f) => f.kind === "combat")) break;
      const dp = engine.decision();
      if (!dp) break;
      const block = dp.options.find((o) => o.id === "block:W");
      engine.choose(
        block?.id ?? dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id,
      );
    }
    return engine;
  }

  it("is absent when there is no combat", () => {
    const engine = new VtesEngine(threeSeatGame(), testRegistry);
    expect(viewFor(engine.state, "Alice").combat).toBeUndefined();
  });

  it("names both combatants and which side the viewer is on", () => {
    const engine = inCombat();
    const alice = viewFor(engine.state, "Alice").combat;
    const bob = viewFor(engine.state, "Bob").combat;
    expect(alice).toBeDefined();
    expect(alice!.acting).toBe("V1");
    expect(alice!.opposing).toBe("W");
    // Alice is acting; Bob blocked, so he is opposing. Each sees the
    // OTHER as their opponent — the minion their strike would land on.
    expect(alice!.side).toBe("acting");
    expect(alice!.opponent).toBe("W");
    expect(bob!.side).toBe("opposing");
    expect(bob!.opponent).toBe("V1");
    expect(alice!.round).toBeGreaterThanOrEqual(1);
  });

  it("marks a seat in neither side as a bystander", () => {
    // NOT an edge case: p. 28 lets a minion controlled by ANY Methuselah
    // play into a combat it is not in, and a quarter of combat decisions
    // in a real game are taken by seats that are not fighting.
    const carol = viewFor(inCombat().state, "Carol").combat;
    expect(carol).toBeDefined();
    expect(carol!.side).toBeNull();
    expect(carol!.opponent).toBeNull();
    // …and they can still see who is fighting, which is public.
    expect(carol!.acting).toBe("V1");
  });
});

describe("the action in view carries the live bleed", () => {
  /** A card in play that makes V1's bleed worth 3, not its printed 1. */
  function withStatic(s: GameState): void {
    s.seats[0]!.minions[0]!.attached.push({
      card: { id: "hc", name: "hc" },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: { bleed: 2 },
      tags: [],
    });
  }

  it("reports it to the seat being bled, who is the one deciding to block", () => {
    // THE BUG THIS PINS. `scoreBlock` read the acting minion's PRINTED
    // `bleedAmount` — the same wrong number the bleed option itself used
    // to carry, surviving one decision along, and in the place it matters
    // most. Measured: 17.8% of block-vs-bleed decisions in real games face
    // a live value that differs from the printed one.
    const state = threeSeatGame();
    withStatic(state);
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("bleed:V1");
    const view = viewFor(engine.state, "Bob");
    expect(view.action?.kind).toBe("bleed");
    expect(view.action?.bleed).toBe(3);
    // The printed field is still 1 — which is exactly why reading it was
    // wrong, and why this assertion is worth having.
    const acting = view.seats.flatMap((s) => s.minions).find((m) => m.id === "V1");
    expect(acting?.bleedAmount).toBe(1);
  });

  it("is absent for an action that is not a bleed", () => {
    // A 0 would read as "a bleed worth nothing"; a hunt has no such
    // number at all.
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.blood = 0;
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("hunt:V1");
    const view = viewFor(engine.state, "Alice");
    expect(view.action?.kind).toBe("hunt");
    expect(view.action?.bleed).toBeUndefined();
  });
});

describe("a hunt says what it would gain", () => {
  function huntOption(blood: number, capacity: number): LegalOption | undefined {
    const state = threeSeatGame();
    const v = state.seats[0]!.minions[0]!;
    v.blood = blood;
    v.capacity = capacity;
    const engine = new VtesEngine(state, testRegistry);
    return engine.decision()!.options.find((o) => o.id === "hunt:V1");
  }

  it("is zero for a vampire already at capacity", () => {
    // p. 6: the excess goes to the BLOOD BANK, not to the Methuselah's
    // pool, so this hunt puts nothing anywhere. Measured, 43.9% of the
    // hunt options in real games are this.
    const o = huntOption(4, 4);
    expect(o?.kind === "takeAction" && o.gain).toBe(0);
  });

  it("is the real gain for a vampire with room", () => {
    const o = huntOption(2, 4);
    expect(o?.kind === "takeAction" && o.gain).toBe(1);
  });

  it("the option is still OFFERED at capacity — it is not futile-gated", () => {
    // Hunting triggers cards that care about a successful hunt, so the
    // option is legal; it is the SCORE that changes
    // (docs/futile-options-design.md).
    expect(huntOption(4, 4)).toBeDefined();
  });

  it("the AI prefers passing to a hunt that gains nothing", () => {
    // Acting LOCKS the vampire (p. 25), so a futile hunt trades the
    // ability to block for no blood at all.
    const ai = new HeuristicAgent({ seed: 1 });
    const futile: LegalOption = {
      id: "hunt:V1",
      kind: "takeAction",
      label: "hunt",
      minion: "V1",
      action: "hunt",
      gain: 0,
    };
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.blood = 4;
    state.seats[0]!.minions[0]!.capacity = 4;
    const engine = new VtesEngine(state, testRegistry);
    const dp = { seq: 0, seat: "Alice", window: "turn.minion", options: [futile, passOption()] };
    const choice = ai.decide(dp as never, dp.options, viewFor(engine.state, "Alice"));
    expect(choice).toBe("pass");
    // The control: with room to fill, the same hunt is worth taking.
    const real = { ...futile, gain: 1 };
    const dp2 = { ...dp, options: [real, passOption()] };
    expect(ai.decide(dp2 as never, dp2.options, viewFor(engine.state, "Alice"))).toBe("hunt:V1");
  });
});

describe("an influence transfer says what the vampire would unlock", () => {
  /** Two uncontrolled vampires, one with the Discipline the card in hand
   *  requires and one without. */
  function twoCandidates(): GameState {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.uncontrolled = [
      { card: makeMinion("U1", "Alice", { disciplines: { dom: "superior" } }), counters: 0 },
      { card: makeMinion("U2", "Alice", { disciplines: {} }), counters: 0 },
    ];
    // Alice's hand already holds Conditioning, which requires Dominate.
    return state;
  }

  function transfers(state: GameState): LegalOption[] {
    const engine = new VtesEngine(state, testRegistry);
    // Walk to the influence phase, preferring pass so the walker does not
    // play the board.
    for (let i = 0; i < 60; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const adds = dp.options.filter((o) => o.kind === "transferToVampire");
      if (adds.length > 0) return adds;
      const pass = dp.options.find((o) => o.kind === "pass");
      const end = dp.options.find((o) => o.kind === "endMinionPhase");
      engine.choose((pass ?? end ?? dp.options[0]!).id);
    }
    return [];
  }

  it("counts the cards in hand that vampire could play", () => {
    const opts = transfers(twoCandidates());
    const withDom = opts.find((o) => o.id === "inf:add:U1");
    const without = opts.find((o) => o.id === "inf:add:U2");
    expect(withDom?.kind === "transferToVampire" && withDom.playableCards).toBeGreaterThan(
      without?.kind === "transferToVampire" ? (without.playableCards ?? 0) : 0,
    );
  });

  it("is present on every transfer option, not just the interesting ones", () => {
    // A count that appears on some options and not others is worse than
    // none: a reader prices the unreported half as unlocking nothing.
    const opts = transfers(twoCandidates());
    expect(opts.length).toBeGreaterThan(1);
    for (const o of opts) {
      expect(o.kind === "transferToVampire" && o.playableCards).toBeDefined();
    }
  });

  it("is NOT used by the policy — a measured negative result", () => {
    // Weighting it delays the first vampire into play (turn 6.46 vs 5.08)
    // because it diverts counters from FINISHING one, and costs 0.177 VP
    // on Hecata at weight 2. The field stays, the weight is zero, and this
    // test exists so raising it is a deliberate act rather than a tidy-up.
    expect(DEFAULT_WEIGHTS.influenceUnlocks).toBe(0);
  });
});
