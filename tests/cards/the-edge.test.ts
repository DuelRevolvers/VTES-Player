/**
 * The Edge as a currency (docs/the-edge-design.md).
 * Esteem (100664), Leverage (101098), Instability (100993),
 * Regaining the Upper Hand (101583).
 *
 * One card gains the token, one spends it, one is gated on where it sits,
 * and one moves it by vote. What is worth pinning is that each reads the
 * SAME single token, and that Leverage's rider actually bites — without
 * it p. 21 hands the Edge straight back on the bleed it swelled.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function atPhase(state: GameState, phase: "master" | "minion"): VtesEngine {
  const tf = state.frames.find((f) => f.kind === "turn")!;
  if (tf.kind === "turn") {
    tf.phase = phase;
    // The fixture opens with no master action left.
    if (phase === "master") tf.masterActionsLeft = 1;
  }
  return new VtesEngine(state, testRegistry);
}

/** Walk, preferring `pass`, until `stop` holds. */
function settle(engine: VtesEngine, stop: () => boolean, limit = 40): void {
  for (let i = 0; i < limit; i++) {
    if (stop()) return;
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

describe("Leverage (101098)", () => {
  it("needs the Edge to burn, and the bleed it buys does not hand it back", () => {
    const state = threeSeatGame(); // Alice → Bob → Carol
    state.seats[0]!.hand.push({ id: "lv", name: "Leverage" });

    // NEGATIVE SPACE: without the Edge there is nothing to burn, so the
    // card is not offered at all.
    state.edge = "Bob";
    const noEdge = atPhase(state, "minion");
    settle(noEdge, () => ids(noEdge).some((i) => i === "bleed:V1"), 10);
    runTrace(noEdge, [["Alice", "bleed:V1"]]);
    settle(noEdge, () => ids(noEdge).some((i) => i.startsWith("play:")), 6);
    expect(ids(noEdge).some((i) => i.startsWith("play:Leverage"))).toBe(false);

    // With the Edge: played, burnt, and the successful bleed that follows
    // burns it again rather than handing it to Alice (p. 21).
    const s2 = threeSeatGame();
    s2.seats[0]!.hand.push({ id: "lv", name: "Leverage" });
    s2.edge = "Alice";
    const engine = atPhase(s2, "minion");
    settle(engine, () => ids(engine).some((i) => i === "bleed:V1"), 10);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    settle(engine, () => ids(engine).some((i) => i.startsWith("play:Leverage")), 10);
    const play = ids(engine).find((i) => i.startsWith("play:Leverage"));
    expect(play).toBeDefined();
    const bobPool = s2.seats[1]!.pool;
    runTrace(engine, [["Alice", play!]]);
    // The as-played window has to close before a modifier resolves.
    settle(engine, () => !s2.frames.some((f) => f.kind === "cardPlay"), 12);
    // Burnt as the price: the token goes to the middle of the table.
    expect(s2.edge).toBe(null);
    settle(engine, () => !s2.frames.some((f) => f.kind === "action"));
    // +1 unlimited on top of the base 1 bleed.
    expect(s2.seats[1]!.pool).toBe(bobPool - 2);
    // THE RIDER: a successful bleed of 1+ normally gives the bleeder the
    // Edge. "If you would get the Edge, it is burned instead."
    expect(s2.edge).toBe(null);
  });
});

describe("Instability (100993)", () => {
  it("is gated on where the token sits, and asks the PREY whether to take it", () => {
    const state = threeSeatGame(); // Alice's prey is Bob
    state.seats[0]!.hand.push({ id: "in", name: "Instability" });

    // NEGATIVE SPACE: the Edge is held by someone who is not the prey.
    state.edge = "Carol";
    expect(ids(atPhase(state, "master")).some((i) => i.startsWith("play:Instability"))).toBe(false);

    // Uncontrolled: playable, and the prey gets the question.
    state.edge = null;
    const engine = atPhase(state, "master");
    const play = ids(engine).find((i) => i.startsWith("play:Instability"));
    expect(play).toBeDefined();
    const pool = state.seats[0]!.pool;
    runTrace(engine, [["Alice", play!]]);
    // Settle on the OPTION, not on the seat: Bob is asked to pass in the
    // as-played window first, and stopping there would read a list with
    // only `pass` in it and assert nothing about the card.
    settle(engine, () => ids(engine).includes("choice:Instability:in:preyEdge:take"), 10);
    const dp = engine.decision();
    expect(dp?.seat).toBe("Bob");
    expect(dp?.options.map((o) => o.id)).toContain(
      `choice:Instability:in:preyEdge:take`,
    );
    runTrace(engine, [["Bob", `choice:Instability:in:preyEdge:take`]]);
    expect(state.edge).toBe("Bob");
    // "You gain 2 pool" — unconditional, whatever the prey answered.
    expect(state.seats[0]!.pool).toBe(pool + 2);
  });
});

describe("Esteem (100664)", () => {
  /**
   * V1 rushes Bob's W with Bum's Rush — a DIRECTED action that names a
   * minion rather than a seat, so the Edge-holder has to be found through
   * the target's controller. A bleed would be the wrong test: a
   * successful bleed of 1+ already takes the Edge at p. 21, so by the
   * after-resolution window the target no longer holds it.
   */
  const rushAndLook = (edge: string | null): boolean => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "es", name: "Esteem" }, { id: "br", name: "Bum's Rush" });
    state.edge = edge;
    const engine = atPhase(state, "minion");
    settle(engine, () => ids(engine).some((i) => i.startsWith("play:Bum's Rush")), 10);
    const rush = ids(engine).find((i) => i.startsWith("play:Bum's Rush") && i.includes(":W:"));
    expect(rush, "Bum's Rush at W was never offered").toBeDefined();
    runTrace(engine, [["Alice", rush!]]);
    for (let i = 0; i < 60; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id.startsWith("play:Esteem"))) return true;
      runTrace(engine, [
        [dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id],
      ]);
    }
    return false;
  };

  it("is offered only when the action's target is the seat holding the Edge", () => {
    // Bob controls W, the rushed minion — so Bob is "the Methuselah with
    // the edge" and the target seat comes from the MINION's controller.
    expect(rushAndLook("Bob")).toBe(true);
    // NEGATIVE SPACE: the Edge is elsewhere, or nowhere at all.
    expect(rushAndLook("Carol")).toBe(false);
    expect(rushAndLook(null)).toBe(false);
  });
});

describe("Regaining the Upper Hand (101583)", () => {
  it("offers one term per standing Methuselah, the caller's own included", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "ru", name: "Regaining the Upper Hand" });
    state.edge = "Carol";
    const engine = atPhase(state, "minion");
    settle(engine, () => ids(engine).some((i) => i.startsWith("play:Regaining")), 10);
    const play = ids(engine).find((i) => i.startsWith("play:Regaining"));
    expect(play).toBeDefined();
    runTrace(engine, [["Alice", play!]]);
    settle(engine, () => ids(engine).some((i) => i.startsWith("terms:")), 12);
    const terms = ids(engine).filter((i) => i.startsWith("terms:"));
    // "Choose A Methuselah" — exactly one each, and nothing says it may
    // not be the caller.
    expect(new Set(terms)).toEqual(new Set(["terms:Alice", "terms:Bob", "terms:Carol"]));
  });
});
