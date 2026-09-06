/**
 * Kernel invariants for the allies/retainers gate
 * (docs/allies-retainers-design.md §5–6): ally action legality, the
 * blocked-recruit path, lethal damage → burn cascade, and the
 * life-depletion sweep — behaviors of the engine, not of any one card.
 */

import { describe, expect, it } from "vitest";
import type { PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "./fixtures.ts";

function entry(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [], ...over };
}

describe("ally action legality", () => {
  it("allies may bleed but never hunt; a 0-blood ally is burned, not hungry", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions.push(makeAlly("AL", "Alice", 2, { bleedAmount: 1 }));
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.window).toBe("turn.minion");
    expect(dp.options.some((o) => o.id === "bleed:AL")).toBe(true);
    expect(dp.options.some((o) => o.id === "hunt:AL")).toBe(false);
    // The vampire still has both basic actions.
    expect(dp.options.some((o) => o.id === "hunt:V1")).toBe(true);
  });

  it("a recruited ally may block the same turn it cannot act", () => {
    const state = threeSeatGame();
    // Bob controls an ally recruited THIS turn (flag set).
    state.seats[1]!.minions.push(
      makeAlly("AL", "Bob", 2, { cannotActThisTurn: true }),
    );
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
    ]);

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id === "block:AL")).toBe(true);
  });

  it("cannotActThisTurn expires at end of turn", () => {
    const state = threeSeatGame();
    const ally = makeAlly("AL", "Alice", 2, { cannotActThisTurn: true });
    state.seats[0]!.minions.push(ally);
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "end"], // end minion phase
      ["Alice", "pass"], // end influence
      ["Alice", "pass"], // end discard → Bob's turn
    ]);

    expect(ally.cannotActThisTurn).toBe(false);
  });
});

describe("blocked recruit", () => {
  it("burns the ally card, pays nothing, and no ally enters play", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.hand.push({ id: "pa1", name: "Political Ally" });
    // M needs +1 intercept to beat the recruit action's +1 stealth.
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.attached.push(entry("sb1", "Sport Bike", { statics: { intercept: 1 } }));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Political Ally"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // attempt → success
      // Combat V1 vs M, one uneventful round.
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
      ["Alice", "pass"], ["Bob", "pass"], // damage (1 each)
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    expect(alice.pool).toBe(10); // cost never paid (p. 27)
    expect(alice.minions).toHaveLength(1); // no ally
    expect(state.eventLog.some((e) => e.type === "CardBurned" && e.cardId === "pa1")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "AllyEnteredPlay")).toBe(false);
  });
});

describe("lethal damage on an ally", () => {
  it("burns the ally and its attached cards, and the combat ends", () => {
    const state = threeSeatGame();
    // Bob's 1-life ally blocks V1's bleed; it carries a retainer.
    state.seats[1]!.minions.push(
      makeAlly("AL", "Bob", 1, {
        strength: 1,
        attached: [entry("rev1", "Revenant", { statics: { intercept: 1 }, life: 2 })],
      }),
    );
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:AL"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
      // V1 takes the ally's 1 first (acting minion's damage first).
      ["Alice", "pass"],
      // The ally takes V1's 1: burns its last life — no mend decision,
      // then the combat ends prematurely (end-of-round window still runs).
      ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    expect(state.seats[1]!.minions.some((x) => x.id === "AL")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "MinionBurned" && e.minion === "AL")).toBe(true);
    // The employer's retainer burned with it (p. 11).
    expect(state.eventLog.some((e) => e.type === "PermanentBurned" && e.cardId === "rev1")).toBe(true);
    // No torpor, no wound: allies are burned instead (p. 31–32).
    expect(state.eventLog.some((e) => e.type === "WentToTorpor")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "CombatEnded")).toBe(true);
    // The blocked bleed still failed.
    expect(state.seats[1]!.pool).toBe(10);
  });
});

describe("retainer life depletion", () => {
  it("burnRetainerLife burns the retainer when its last life goes", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.attached.push(entry("rev1", "Revenant", { life: 2 }));
    const engine = new VtesEngine(state, testRegistry);

    engine.burnRetainerLife("rev1", 1);
    expect(v1.attached[0]!.life).toBe(1);
    expect(state.eventLog.some((e) => e.type === "PermanentBurned")).toBe(false);

    engine.burnRetainerLife("rev1", 1);
    expect(v1.attached).toHaveLength(0);
    expect(
      state.eventLog.some((e) => e.type === "PermanentBurned" && e.cardId === "rev1"),
    ).toBe(true);
  });
});
