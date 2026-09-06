/**
 * Hunting grounds (docs/one-off-sweep.md): the generic unique location
 * that lets one ready vampire gain 1 blood during the controller's unlock
 * phase — once per location per turn, once per vampire per turn (~13 cards
 * share this exact text; one mechanic covers them all).
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function hg(id: string, name: string): PermanentInPlay {
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["location", "huntingGround"],
  };
}

function unlockState(): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.phase = "unlock";
    tf.unlockDone = false;
    tf.unlockAbilitiesDone = false;
  }
  state.seats[0]!.minions[0]!.blood = 2; // V1
  return state;
}

describe("Hunting grounds", () => {
  it("lets a ready vampire gain 1 blood during the unlock phase", () => {
    const state = unlockState();
    state.seats[0]!.permanents.push(hg("hg1", "Academic Hunting Ground"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "ability:Academic Hunting Ground:hg1:V1"]]);

    const v1 = state.seats[0]!.minions[0]!;
    expect(v1.blood).toBe(3);
    expect(v1.usedHuntingGroundThisTurn).toBe(true);
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "hg1")!.usedThisPhase).toBe(true);
  });

  it("a vampire can use only one hunting ground per turn", () => {
    const state = unlockState();
    state.seats[0]!.permanents.push(hg("hg1", "Academic Hunting Ground"));
    state.seats[0]!.permanents.push(hg("hg2", "Park Hunting Ground"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "ability:Academic Hunting Ground:hg1:V1"]]);

    // The second hunting ground offers V1 nothing now (already fed).
    const dp = engine.decision()!;
    const v1Options = dp.seat === "Alice" ? dp.options : [];
    expect(v1Options.some((o) => o.id.startsWith("ability:Park Hunting Ground:hg2:V1"))).toBe(false);
    expect(state.seats[0]!.minions[0]!.blood).toBe(3); // only one gain
  });

  it("feeds only vampires, and honours the per-location once-per-turn limit", () => {
    const state = unlockState();
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { blood: 1, capacity: 5 }));
    state.seats[0]!.permanents.push(hg("hg1", "Academic Hunting Ground"));
    const engine = new VtesEngine(state, testRegistry);

    // First V1 uses it; the location is now spent for the turn, so V2 gets
    // no option from the same location.
    runTrace(engine, [["Alice", "ability:Academic Hunting Ground:hg1:V1"]]);
    const dp = engine.decision()!;
    const opts = dp.seat === "Alice" ? dp.options : [];
    expect(opts.some((o) => o.id.startsWith("ability:Academic Hunting Ground:hg1:V2"))).toBe(false);
    expect(state.seats[0]!.minions.find((m) => m.id === "V2")!.blood).toBe(1);
  });
});
