/**
 * Dreams of the Sphinx (100588) — the first counter one-off on the Gate 8
 * substrate. Each lock adds a counter; the card burns at 3. Exercises the
 * master-phase "add 1 blood to an uncontrolled vampire" and unlock-phase
 * "gain 1 pool if you have the Edge" abilities.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function withSphinx(counters: number, phase: "master" | "unlock"): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.phase = phase;
    tf.masterActionsLeft = 1;
    if (phase === "unlock") {
      tf.unlockAbilitiesDone = false;
      tf.unlockDone = false;
    }
  }
  state.seats[0]!.permanents.push({
    card: { id: "ds1", name: "Dreams of the Sphinx" },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["location"],
    counters,
  });
  return state;
}

describe("Dreams of the Sphinx", () => {
  it("locks to add 1 blood to an uncontrolled vampire, gaining a counter", () => {
    const state = withSphinx(0, "master");
    state.seats[0]!.uncontrolled.push({
      card: makeMinion("U", "Alice", { blood: 0, capacity: 5 }),
      counters: 0,
    });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "ability:Dreams of the Sphinx:ds1:blood:U"]]);

    const perm = state.seats[0]!.permanents.find((p) => p.card.id === "ds1")!;
    expect(perm.locked).toBe(true);
    expect(perm.counters).toBe(1);
    // The uncontrolled vampire gained 1 blood from the bank — tracked as
    // counters on the uncontrolled entry (no pool change).
    expect(state.seats[0]!.uncontrolled[0]!.counters).toBe(1);
  });

  it("burns itself when the third counter lands", () => {
    const state = withSphinx(2, "master");
    state.seats[0]!.uncontrolled.push({
      card: makeMinion("U", "Alice", { blood: 0, capacity: 5 }),
      counters: 0,
    });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "ability:Dreams of the Sphinx:ds1:blood:U"]]);

    // Third counter → burned.
    expect(state.seats[0]!.permanents.some((p) => p.card.id === "ds1")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "PermanentBurned" && e.cardId === "ds1")).toBe(true);
  });

  it("locks during the unlock phase to gain 1 pool while holding the Edge", () => {
    const state = withSphinx(0, "unlock");
    state.edge = "Alice";
    const engine = new VtesEngine(state, testRegistry);

    // The unlock-phase Edge ability is offered; use it.
    runTrace(engine, [["Alice", "ability:Dreams of the Sphinx:ds1:pool"]]);

    expect(state.seats[0]!.pool).toBe(11); // 10 + 1
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "ds1")!.counters).toBe(1);
  });
});
