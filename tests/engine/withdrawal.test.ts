/**
 * Withdrawing from the game (p. 38), quoted in full because every clause
 * of it is a test here:
 *
 *   "If you have exhausted your library and begin your turn with less
 *    than a full hand, you have the option to withdraw from the game. To
 *    exercise this option, you must announce your intent to withdraw
 *    during your unlock phase. For the withdrawal to succeed, you must
 *    meet the following conditions: None of your minions enter combat
 *    until your next unlock phase. None of your minions lose (or spend)
 *    any blood until your next unlock phase. You do not lose (or spend)
 *    any pool until your next unlock phase. If you have met these
 *    conditions when you would start your unlock phase, you successfully
 *    withdraw. The withdrawal fails if you lose a single blood or pool
 *    counter, even if you also gain enough to make up for the loss. If
 *    you successfully withdraw, you receive 1 victory point … Your
 *    predator does not get 1 victory point or any pool for your
 *    withdrawal."
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "./fixtures.ts";

/** Alice's unlock phase. The fixture's seats already have empty libraries,
 *  which is the printed precondition; `hand` is set per test. */
function aliceUnlock(over: { hand?: { id: string; name: string }[] } = {}): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.seat = "Alice";
    tf.phase = "unlock";
    tf.unlockDone = false;
    tf.unlockAbilitiesDone = false;
  }
  if (over.hand) state.seats[0]!.hand = over.hand;
  return state;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/**
 * Walk to the given seat's next unlock phase, doing NOTHING on the way.
 *
 * Pass, then end the phase, and only then anything else — a walker that
 * takes `options[0]` plays the board, and here it bled the withdrawing
 * seat with their own predator's minion and broke the withdrawal it was
 * meant to be measuring. (Which is the engine being right: a predator
 * bleeding you for one pool does exactly that, p. 38.)
 */
function toNextUnlock(engine: VtesEngine, seat: string, limit = 400): boolean {
  for (let i = 0; i < limit; i++) {
    if (engine.state.eventLog.some((e) => e.type === "Withdrew" && e.seat === seat)) {
      return true;
    }
    const dp = engine.decision();
    if (!dp) return false;
    const quiet =
      dp.options.find((o) => o.kind === "pass") ??
      dp.options.find((o) => o.kind === "endMinionPhase") ??
      dp.options[0]!;
    engine.choose(quiet.id);
  }
  return false;
}

describe("when a withdrawal may be announced", () => {
  it("is offered with an exhausted library and a short hand", () => {
    const engine = new VtesEngine(aliceUnlock(), testRegistry);
    expect(engine.state.seats[0]!.library).toEqual([]);
    expect(optionIds(engine)).toContain("withdraw");
  });

  it("is NOT offered while the library still has cards", () => {
    // The control. Without it, "exhausted" could be implemented as
    // "always" and the test above would not notice.
    const state = aliceUnlock();
    state.seats[0]!.library = [{ id: "l1", name: "Blood Doll" }];
    const engine = new VtesEngine(state, testRegistry);
    expect(optionIds(engine)).not.toContain("withdraw");
  });

  it("is NOT offered with a full hand", () => {
    const full = Array.from({ length: 7 }, (_, i) => ({ id: `h${i}`, name: "Blood Doll" }));
    const engine = new VtesEngine(aliceUnlock({ hand: full }), testRegistry);
    expect(optionIds(engine)).not.toContain("withdraw");
  });

  it("is offered to the TURN's seat only", () => {
    // "…during YOUR unlock phase". Bob's library is empty too, but it is
    // not his turn.
    const engine = new VtesEngine(aliceUnlock(), testRegistry);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    expect(dp.options.some((o) => o.id === "withdraw")).toBe(true);
  });
});

describe("a withdrawal that holds", () => {
  it("succeeds at the next unlock phase, for 1 victory point", () => {
    const engine = new VtesEngine(aliceUnlock(), testRegistry);
    engine.choose("withdraw");
    expect(engine.state.seats[0]!.withdrawing).toBe(true);
    // Nothing announced yet beyond the intent.
    expect(engine.state.seats[0]!.ousted).toBe(false);

    expect(toNextUnlock(engine, "Alice")).toBe(true);
    const alice = engine.state.seats[0]!;
    expect(alice.victoryPoints).toBe(1);
    expect(alice.ousted).toBe(true);
  });

  it("gives the PREDATOR nothing — no victory point and no pool", () => {
    // The whole reason to withdraw rather than be ousted. Alice's
    // predator is Carol (Alice → Bob → Carol → Alice).
    const engine = new VtesEngine(aliceUnlock(), testRegistry);
    const carolPool = engine.state.seats[2]!.pool;
    engine.choose("withdraw");
    expect(toNextUnlock(engine, "Alice")).toBe(true);

    const carol = engine.state.seats[2]!;
    expect(carol.victoryPoints).toBe(0);
    expect(carol.pool).toBe(carolPool);
  });
});

describe("a withdrawal that is broken", () => {
  function announced(): VtesEngine {
    const engine = new VtesEngine(aliceUnlock(), testRegistry);
    engine.choose("withdraw");
    expect(engine.state.seats[0]!.withdrawing).toBe(true);
    return engine;
  }

  it("fails when the Methuselah loses pool", () => {
    const engine = announced();
    engine.emit({ type: "PoolBurned", seat: "Alice", amount: 1 });
    expect(engine.state.seats[0]!.withdrawing).toBe(false);
    expect(
      engine.state.eventLog.some((e) => e.type === "WithdrawalFailed" && e.seat === "Alice"),
    ).toBe(true);
  });

  it("fails when a minion loses blood", () => {
    const engine = announced();
    engine.emit({ type: "BloodBurned", minion: "V1", amount: 1 });
    expect(engine.state.seats[0]!.withdrawing).toBe(false);
  });

  it("fails when a minion enters combat — on either side of it", () => {
    // "None of YOUR minions enter combat": Alice's V1 being attacked
    // counts exactly as much as V1 attacking.
    const attacked = announced();
    attacked.emit({ type: "CombatBegan", acting: "W", opposing: "V1" });
    expect(attacked.state.seats[0]!.withdrawing).toBe(false);

    const attacking = announced();
    attacking.emit({ type: "CombatBegan", acting: "V1", opposing: "W" });
    expect(attacking.state.seats[0]!.withdrawing).toBe(false);
  });

  it("fails on a single lost counter EVEN IF it is made back", () => {
    // The sentence that makes this a latch rather than a comparison of
    // totals: "even if you also gain enough to make up for the loss".
    const engine = announced();
    const before = engine.state.seats[0]!.pool;
    engine.emit({ type: "PoolBurned", seat: "Alice", amount: 1 });
    engine.emit({ type: "PoolGained", seat: "Alice", amount: 5 });
    expect(engine.state.seats[0]!.pool).toBeGreaterThan(before);
    expect(engine.state.seats[0]!.withdrawing).toBe(false);
  });

  it("is unmoved by ANOTHER Methuselah's losses", () => {
    // The negative case that keeps the latch keyed to the right seat.
    const engine = announced();
    engine.emit({ type: "PoolBurned", seat: "Bob", amount: 2 });
    engine.emit({ type: "BloodBurned", minion: "W", amount: 1 });
    engine.emit({ type: "CombatBegan", acting: "W", opposing: "N" });
    expect(engine.state.seats[0]!.withdrawing).toBe(true);
  });

  it("leaves the seat in the game when it fails", () => {
    const engine = announced();
    engine.emit({ type: "PoolBurned", seat: "Alice", amount: 1 });
    expect(toNextUnlock(engine, "Alice", 120)).toBe(false);
    expect(engine.state.seats[0]!.ousted).toBe(false);
    expect(engine.state.seats[0]!.victoryPoints).toBe(0);
  });
});
