/**
 * The masters gate: master phase actions, trifles, pool costs, and the
 * first cancel card. Cards: Misdirection (101225), Life in the City
 * (101104), Minion Tap (101217), Sudden Reversal (101896, bespoke).
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** threeSeatGame, but starting in Alice's master phase with 1 MPA. */
function masterPhaseGame(aliceCards: string[]): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  const frame = state.frames[0]!;
  if (frame.kind !== "turn") throw new Error("fixture");
  frame.phase = "master";
  frame.masterActionsLeft = 1;
  aliceCards.forEach((name, i) =>
    state.seats[0]!.hand.push({ id: `mc${i}`, name }),
  );
  return { state, engine: new VtesEngine(state, testRegistry) };
}

describe("Misdirection (101225) and master phase actions", () => {
  it("locks any minion for 1 pool; the master phase action is spent", () => {
    const { state, engine } = masterPhaseGame(["Misdirection"]);
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;

    runTrace(engine, [
      ["Alice", `play:Misdirection:-:M`],
      // as-played window around the master card.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    expect(m.locked).toBe(true);
    expect(state.seats[0]!.pool).toBe(9); // paid 1 pool

    // MPA spent: no more master card options, only ending the phase.
    const dp = engine.decision()!;
    expect(dp.window).toBe("turn.master");
    expect(dp.options.map((o) => o.id)).toEqual(["pass"]);
  });
});

describe("Life in the City (101104) — trifle", () => {
  it("refunds the master phase action once, and only once", () => {
    const { state, engine } = masterPhaseGame([
      "Life in the City",
      "Life in the City",
      "Misdirection",
    ]);
    const v1 = state.seats[0]!.minions[0]!;
    v1.blood = 1;

    runTrace(engine, [
      // First trifle: blood to V1; the MPA is refunded on resolution.
      ["Alice", "play:Life in the City:-:V1:mc0"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    expect(v1.blood).toBe(2);
    let dp = engine.decision()!;
    // Refund happened → Misdirection is still on offer.
    expect(dp.options.some((o) => o.id.startsWith("play:Misdirection"))).toBe(true);

    runTrace(engine, [
      // Second trifle: no second refund (one per master phase).
      ["Alice", "play:Life in the City:-:V1:mc1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    expect(v1.blood).toBe(3);
    dp = engine.decision()!;
    expect(dp.options.map((o) => o.id)).toEqual(["pass"]);
  });
});

describe("Minion Tap (101217)", () => {
  it("moves a chosen amount of blood from an own vampire to pool", () => {
    const { state, engine } = masterPhaseGame(["Minion Tap"]);
    // V1 has 2 blood → X options 1 and 2.
    const dp = engine.decision()!;
    const taps = dp.options.filter((o) => o.id.startsWith("play:Minion Tap"));
    expect(taps).toHaveLength(2);

    runTrace(engine, [
      ["Alice", "play:Minion Tap:-:V1:2"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    expect(state.seats[0]!.minions[0]!.blood).toBe(0);
    expect(state.seats[0]!.pool).toBe(12);
  });
});

describe("Sudden Reversal (101896) — the first cancel", () => {
  it("cancels another Methuselah's master as played, refunding its cost", () => {
    const { state, engine } = masterPhaseGame(["Misdirection"]);
    const bob = state.seats[1]!;
    bob.hand.push({ id: "sr1", name: "Sudden Reversal" });
    const m = bob.minions.find((x) => x.id === "M")!;

    runTrace(engine, [
      ["Alice", "play:Misdirection:-:M"],
      // as-played window: Alice passes; Bob reverses.
      ["Alice", "pass"],
      ["Bob", "play:Sudden Reversal"],
      // Sudden Reversal's own as-played window (it too is a master —
      // nobody can afford to reverse it here).
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Back in Misdirection's window; it is now canceled — remaining
      // participants still get their say, then it fizzles.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    // Canceled: M never locked, Alice's pool refunded.
    expect(m.locked).toBe(false);
    expect(state.seats[0]!.pool).toBe(10);
    expect(state.eventLog.some((e) => e.type === "CardCanceled")).toBe(true);

    // Alice's MPA was still consumed (the card was played, p. 16)...
    const dp = engine.decision()!;
    expect(dp.window).toBe("turn.master");
    expect(dp.options.map((o) => o.id)).toEqual(["pass"]);
    // ...and Bob owes his next master phase action (p. 8), even now.
    expect(bob.outOfTurnMasterUsed).toBe(true);

    // Walk to Bob's master phase: he has 0 MPAs — pass is his only option.
    runTrace(engine, [
      ["Alice", "pass"], // end master phase
      ["Alice", "end"], // minion phase
      ["Alice", "pass"], // influence
      ["Alice", "pass"], // discard → Bob's turn
      // Bob's unlock is no longer silent: this fixture's libraries are
      // empty and hands are short, which is exactly the condition for
      // announcing a withdrawal (p. 38). He declines.
      ["Bob", "pass"],
    ]);
    const bobMaster = engine.decision()!;
    expect(bobMaster.seat).toBe("Bob");
    expect(bobMaster.window).toBe("turn.master");
    expect(bobMaster.options.map((o) => o.id)).toEqual(["pass"]);
    expect(bob.outOfTurnMasterUsed).toBe(false); // debt consumed
  });
});
