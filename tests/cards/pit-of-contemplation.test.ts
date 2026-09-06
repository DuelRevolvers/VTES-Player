/**
 * Pit of Contemplation (102291) — a +1 stealth Hecata action that puts
 * itself in play with 1 counter; Hecata you control add counters to it as
 * further +1 stealth actions (the first granted action whose effect is not
 * entering combat, docs/granted-actions-design.md §5); during your unlock
 * phase you can burn it to send a neighbour's vampire with capacity below
 * the counter count to their uncontrolled region.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function pit(counters: number): PermanentInPlay {
  return {
    card: { id: "pit1", name: "Pit of Contemplation" },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["Pit of Contemplation", "location"],
    counters,
  };
}

/** Alice's minion phase, with a Hecata (V1) and a non-Hecata (A2). */
function hecataGame(): GameState {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  v1.clan = "Hecata";
  state.seats[0]!.minions.push(makeMinion("A2", "Alice", { clan: "Ventrue" }));
  return state;
}

describe("Pit of Contemplation (102291)", () => {
  it("puts itself in play with 1 counter on a successful action", () => {
    const state = hecataGame();
    state.seats[0]!.hand.push({ id: "p1", name: "Pit of Contemplation" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Pit of Contemplation:basic:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);

    const entry = state.seats[0]!.permanents.find((p) => p.card.name === "Pit of Contemplation");
    expect(entry?.counters).toBe(1);
    // Only a Hecata may play it ("Requires…", via the card's clan).
    expect(state.seats[0]!.minions[0]!.locked).toBe(true);
  });

  it("a Hecata adds a counter as a +1 stealth action; a non-Hecata cannot", () => {
    const state = hecataGame();
    state.seats[0]!.permanents.push(pit(1));
    const engine = new VtesEngine(state, testRegistry);

    const before = engine.decision()!;
    expect(before.options.some((o) => o.id === "act:Pit of Contemplation:pit1:counter:V1")).toBe(true);
    // Negative space: the Ventrue is not offered the Hecata-only action.
    expect(before.options.some((o) => o.id === "act:Pit of Contemplation:pit1:counter:A2")).toBe(false);

    runTrace(engine, [
      ["Alice", "act:Pit of Contemplation:pit1:counter:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A (blocks declined)
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolves
    ]);

    expect(state.seats[0]!.permanents[0]!.counters).toBe(2);
    // Undirected (no target), +1 stealth from the granted action itself.
    const announced = state.eventLog.find((e) => e.type === "ActionAnnounced")!;
    expect(announced).toMatchObject({ target: null, directed: false, acting: "V1" });
    expect(
      state.eventLog.some(
        (e) => e.type === "StealthModified" && e.source === "Pit of Contemplation" && e.delta === 1,
      ),
    ).toBe(true);
    // The acting Hecata locked, and has spent this card's action for the turn.
    expect(state.seats[0]!.minions[0]!.locked).toBe(true);
    expect(state.seats[0]!.permanents[0]!.grantedActionUses).toEqual([
      { minion: "V1", key: "addCounter" },
    ]);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    expect(dp.options.some((o) => o.id.includes(":counter:"))).toBe(false);
  });

  it("any vampire, including an opponent's, can burn it as a Ⓓ action", () => {
    const state = hecataGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob"; // Bob's minion phase
    state.seats[0]!.permanents.push(pit(3));
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    // Bob's vampires may burn Alice's Pit; the Hecata counter action is
    // Alice's alone and is not offered to Bob.
    expect(dp.options.some((o) => o.id === "act:Pit of Contemplation:pit1:burn:W")).toBe(true);
    expect(dp.options.some((o) => o.id.includes(":counter:"))).toBe(false);

    runTrace(engine, [
      ["Bob", "act:Pit of Contemplation:pit1:burn:W"],
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // announce
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // A
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // C → resolves
    ]);

    expect(state.eventLog.find((e) => e.type === "ActionAnnounced")).toMatchObject({
      target: "Alice",
      directed: true,
    });
    expect(state.seats[0]!.permanents).toHaveLength(0);
  });

  it("a blocked counter action adds nothing", () => {
    const state = hecataGame();
    state.seats[0]!.permanents.push(pit(1));
    // The granted action carries +1 stealth, so the blocker needs +1
    // intercept to reach it (p. 26).
    state.seats[1]!.minions[0]!.attached.push({
      card: { id: "bike", name: "Sport Bike" },
      locked: false,
      usedThisPhase: false,
      statics: { intercept: 1 },
      tags: [],
    });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "act:Pit of Contemplation:pit1:counter:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:W"], // undirected: the prey may block
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // attempt → combat
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
      ["Alice", "pass"], ["Bob", "pass"], // damage
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    expect(state.eventLog.find((e) => e.type === "ActionResolved")).toMatchObject({
      success: false,
    });
    expect(state.seats[0]!.permanents[0]!.counters).toBe(1); // unchanged
  });

  it("burns itself in the unlock phase to uncontrol a small neighbouring vampire", () => {
    const state = hecataGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "unlock";
      tf.unlockDone = false;
      tf.unlockAbilitiesDone = false;
    }
    state.seats[0]!.permanents.push(pit(4)); // X = 4
    const bob = state.seats[1]!;
    bob.minions[0]!.capacity = 3; // W: prey's vampire, capacity < 4
    bob.minions[1]!.capacity = 6; // M: too big
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "ability:Pit of Contemplation:pit1:W")).toBe(true);
    // Negative space: capacity 6 is not "less than X", and Alice's own
    // minions are never eligible (predator or prey only).
    expect(dp.options.some((o) => o.id === "ability:Pit of Contemplation:pit1:M")).toBe(false);
    expect(dp.options.some((o) => o.id === "ability:Pit of Contemplation:pit1:V1")).toBe(false);

    runTrace(engine, [["Alice", "ability:Pit of Contemplation:pit1:W"]]);

    expect(bob.minions.some((m) => m.id === "W")).toBe(false);
    expect(bob.uncontrolled.some((u) => u.card.id === "W")).toBe(true);
    expect(state.seats[0]!.permanents.some((p) => p.card.id === "pit1")).toBe(false); // burned
  });
});
