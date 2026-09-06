/**
 * Constant Revolution (100416) & Smiling Jack, The Anarch (101811) — counter
 * cards that accumulate during their controller's unlock phase and burn
 * (counters) pool from each other Methuselah during theirs (via onAnyUnlock).
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { threeSeatGame, testRegistry } from "../engine/fixtures.ts";

function unlockPhase(seat: string): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.seat = seat;
    tf.phase = "unlock";
    tf.unlockDone = false;
    tf.edgeDone = true;
    tf.unlockAbilitiesDone = true;
  }
  return state;
}

function perm(id: string, name: string, counters: number): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [], counters };
}

/**
 * Since 2026-09-02 the punish is a per-unit CHOICE, not an automatic pool
 * burn: both cards print an alternative currency, and the payer picks one
 * unit at a time (docs/unlock-tolls-design.md §2). Paying every unit in
 * pool reproduces exactly the old behaviour, which is what these two
 * pre-existing tests check.
 */
function payAllInPool(engine: VtesEngine): void {
  for (let i = 0; i < 20; i++) {
    const dp = engine.decision();
    const pool = dp?.options.find((o) => o.id.includes(":unlockToll:pool"));
    if (!pool) return;
    engine.choose(pool.id);
  }
}

describe("Constant Revolution (100416)", () => {
  it("adds a counter during its controller's unlock phase", () => {
    const state = unlockPhase("Alice");
    state.seats[0]!.permanents.push(perm("cr1", "Constant Revolution", 1));
    const engine = new VtesEngine(state, testRegistry);
    engine.decision(); // triggers the unlock phase

    expect(state.seats[0]!.permanents.find((p) => p.card.id === "cr1")!.counters).toBe(2);
  });

  it("burns (counters) pool from another Methuselah during their unlock", () => {
    const state = unlockPhase("Bob");
    state.seats[0]!.permanents.push(perm("cr1", "Constant Revolution", 2)); // Alice's
    const engine = new VtesEngine(state, testRegistry);
    payAllInPool(engine); // Bob's unlock: two units, both paid in pool

    expect(state.seats[1]!.pool).toBe(8); // 10 − 2
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "cr1")!.counters).toBe(2); // unchanged
  });
});

describe("Smiling Jack, The Anarch (101811)", () => {
  it("moves 1 pool onto itself as a counter during its controller's unlock", () => {
    const state = unlockPhase("Alice");
    state.seats[0]!.permanents.push(perm("sj1", "Smiling Jack, The Anarch", 0));
    const engine = new VtesEngine(state, testRegistry);
    engine.decision();

    expect(state.seats[0]!.pool).toBe(9); // paid 1
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "sj1")!.counters).toBe(1);
  });

  it("burns (counters) pool from another Methuselah during their unlock", () => {
    const state = unlockPhase("Carol");
    state.seats[0]!.permanents.push(perm("sj1", "Smiling Jack, The Anarch", 3)); // Alice's
    const engine = new VtesEngine(state, testRegistry);
    payAllInPool(engine); // Carol's unlock: three units, all paid in pool

    expect(state.seats[2]!.pool).toBe(7); // 10 − 3
  });
});
