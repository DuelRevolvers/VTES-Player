/**
 * Curmudgeon (100482): "Master: archetype. Trifle. Put this card on a vampire
 * you control. During your prey's unlock phase, you may choose a minion
 * controlled by your prey. If that minion is blocked this turn, you may lock
 * this card to move 1 blood from the blood bank to this vampire. A vampire can
 * have only one archetype."
 *
 * Bob is Alice's prey in the threeSeatGame fixture.
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function setup(): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { blood: 1, capacity: 5 });
  const engine = new VtesEngine(state, testRegistry);
  engine.putPermanentInPlay({
    card: { id: "cm", name: "Curmudgeon" },
    seat: "Alice",
    attachTo: "V1",
    statics: {},
    tags: ["archetype"],
  });
  return { state, engine };
}

function fire(engine: VtesEngine, state: GameState, unlockingSeat: "Alice" | "Bob" | "Carol"): void {
  const card = find(state, "V1").attached.find((p) => p.card.name === "Curmudgeon")!;
  testRegistry["Curmudgeon"]!.onAnyUnlock!(card, { seat: "Alice", minion: "V1" }, unlockingSeat, engine as any);
}

describe("Curmudgeon (100482)", () => {
  it("in the prey's unlock phase with a blocked prey minion, the controller is asked", () => {
    const { state, engine } = setup();
    find(state, "M").blockedSinceUnlock = true; // Bob's minion (Bob is Alice's prey)
    fire(engine, state, "Bob");
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    expect(dp.options.some((o) => o.id.includes(":yes"))).toBe(true);
  });

  it("no question when no prey minion was blocked", () => {
    const { state, engine } = setup();
    fire(engine, state, "Bob");
    const dp = engine.decision();
    expect(dp?.seat === "Alice" && dp.options.some((o) => o.id.includes(":yes"))).toBeFalsy();
  });

  it("no question in another seat's unlock phase (not the prey's)", () => {
    const { state, engine } = setup();
    find(state, "M").blockedSinceUnlock = true;
    fire(engine, state, "Carol");
    const dp = engine.decision();
    expect(dp?.seat === "Alice" && dp.options.some((o) => o.id.includes(":yes"))).toBeFalsy();
  });

  it("'yes' locks the card and moves 1 blood to the bearer", () => {
    const { state, engine } = setup();
    find(state, "M").blockedSinceUnlock = true;
    fire(engine, state, "Bob");
    engine.choose(engine.decision()!.options.find((o) => o.id.includes(":yes"))!.id);
    expect(find(state, "V1").blood).toBe(2);
    expect(find(state, "V1").attached.find((p) => p.card.name === "Curmudgeon")!.locked).toBe(true);
  });

  it("the blocked flag is per minion: a blocked minion of another seat does not count", () => {
    const { state, engine } = setup();
    // A blocked minion of Carol (not the prey) must not count.
    const carolMinion = state.seats.flatMap((s) => s.minions).find((m) => m.controller === "Carol")!;
    carolMinion.blockedSinceUnlock = true;
    fire(engine, state, "Bob");
    const dp = engine.decision();
    expect(dp?.seat === "Alice" && dp.options.some((o) => o.id.includes(":yes"))).toBeFalsy();
  });
});
