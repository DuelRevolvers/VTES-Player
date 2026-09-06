/**
 * Aranthebes, The Immortal (100079) — the last card of the "burn this card
 * as a Ⓓ action" family. Three clauses: a lock-to-debuff-stealth ability
 * against the predator, a conditional aura ("while Aranthebes is unlocked,
 * vampires with capacity 4 or less get -1 bleed against you"), and a
 * shuffle-into-library outcome instead of a burn.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function aranthebes(locked = false): PermanentInPlay {
  return {
    card: { id: "ara", name: "Aranthebes, The Immortal" },
    locked,
    usedThisPhase: false,
    statics: {},
    tags: ["Aranthebes, The Immortal"],
    aura: {
      scope: "global",
      maxCapacity: 4,
      bleedAgainstController: -1,
      requiresUnlocked: true,
    },
  };
}

/** Carol (Alice's predator) bleeds Alice, who controls Aranthebes. */
function predatorBleeds(entry: PermanentInPlay, capacity: number): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") tf.seat = "Carol";
  state.seats[0]!.permanents.push(entry);
  state.seats[2]!.minions[0]!.capacity = capacity;
  return state;
}

function bleedThrough(state: GameState): number {
  const before = state.seats[0]!.pool;
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Carol", "bleed:N"],
    ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], // announce
    ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], // A
    ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], // C → resolves
  ]);
  return before - state.seats[0]!.pool;
}

describe("Aranthebes, The Immortal (100079)", () => {
  it("takes 1 off a small vampire's bleed while it is unlocked", () => {
    expect(bleedThrough(predatorBleeds(aranthebes(), 4))).toBe(0); // 1 - 1
  });

  it("does nothing while it is locked", () => {
    expect(bleedThrough(predatorBleeds(aranthebes(true), 4))).toBe(1);
  });

  it("does nothing to a vampire of capacity 5 or more", () => {
    expect(bleedThrough(predatorBleeds(aranthebes(), 5))).toBe(1);
  });

  it("locks to give a predator's acting minion -1 stealth", () => {
    const state = predatorBleeds(aranthebes(), 5); // big, so no bleed aura
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Carol", "bleed:N"],
      ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], // announce
      ["Carol", "pass"],
      ["Alice", "ability:Aranthebes, The Immortal:ara:stealth"],
    ]);

    expect(state.seats[0]!.permanents[0]!.locked).toBe(true);
    expect(
      state.eventLog.some(
        (e) =>
          e.type === "StealthModified" &&
          e.source === "Aranthebes, The Immortal" &&
          e.delta === -1,
      ),
    ).toBe(true);
  });

  it("offers that ability only against the predator, not the prey", () => {
    // Bob is Alice's PREY; his bleed should get no Aranthebes debuff.
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    state.seats[0]!.permanents.push(aranthebes());
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Bob", "bleed:W"],
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], // announce
      ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const alice = engine.decision()!;
    expect(alice.seat).toBe("Alice");
    expect(alice.options.some((o) => o.id.startsWith("ability:Aranthebes"))).toBe(false);
  });

  it("is shuffled into its owner's library by a capacity-5+ vampire", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    state.seats[0]!.permanents.push(aranthebes());
    state.seats[0]!.library.push({ id: "lib1", name: "Conditioning" });
    state.seats[1]!.minions[0]!.capacity = 5; // W qualifies
    state.seats[1]!.minions[1]!.capacity = 3; // M does not
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(
      dp.options.some((o) => o.id === "act:Aranthebes, The Immortal:ara:shuffle:W"),
    ).toBe(true);
    expect(
      dp.options.some((o) => o.id === "act:Aranthebes, The Immortal:ara:shuffle:M"),
    ).toBe(false);

    runTrace(engine, [
      ["Bob", "act:Aranthebes, The Immortal:ara:shuffle:W"],
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // announce
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // A
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // C → resolves
    ]);

    // Out of play, back in ALICE's library (not burned, not Bob's).
    expect(state.seats[0]!.permanents).toHaveLength(0);
    expect(state.seats[0]!.library.some((c) => c.id === "ara")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "PermanentBurned")).toBe(false);
  });
});
