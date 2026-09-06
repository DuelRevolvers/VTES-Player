/**
 * The first two cards that move control (docs/control-change-design.md):
 * Powerbase: Montreal (101439), a stealable location, and Cave of Apples
 * (100311), which corrupts a prey's minion with a Ⓓ action and takes
 * control of it once the counters reach its capacity or cost.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function loc(id: string, name: string): PermanentInPlay {
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["location"],
  };
}

describe("Powerbase: Montreal (101439)", () => {
  it("adds 1 blood to an uncontrolled vampire in its controller's influence phase", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "influence";
      tf.transfersLeft = 0;
    }
    state.seats[0]!.permanents.push(loc("pm1", "Powerbase: Montreal"));
    state.seats[0]!.uncontrolled.push({
      card: makeMinion("U", "Alice", { blood: 0, capacity: 5 }),
      counters: 0,
    });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "ability:Powerbase: Montreal:pm1:U"]]);

    expect(state.seats[0]!.uncontrolled[0]!.counters).toBe(1);
  });

  it("is stolen by a vampire's directed action, ability and all", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    state.seats[0]!.permanents.push(loc("pm1", "Powerbase: Montreal"));
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "act:Powerbase: Montreal:pm1:steal:W")).toBe(true);

    runTrace(engine, [
      ["Bob", "act:Powerbase: Montreal:pm1:steal:W"],
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // announce
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // A (Alice declines)
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // C → resolves
    ]);

    expect(state.eventLog.find((e) => e.type === "ActionAnnounced")).toMatchObject({
      target: "Alice",
      directed: true,
    });
    expect(state.seats[0]!.permanents).toHaveLength(0);
    expect(state.seats[1]!.permanents.some((p) => p.card.id === "pm1")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "ControlChanged")).toBe(true);
  });

  it("survives in its owner's hands if the steal is blocked", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    state.seats[0]!.permanents.push(loc("pm1", "Powerbase: Montreal"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Bob", "act:Powerbase: Montreal:pm1:steal:W"],
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // announce
      ["Bob", "pass"],
      ["Alice", "block:V1"],
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // attempt → combat
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // before range
      ["Bob", "pass"], ["Alice", "pass"], // range
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // before strikes
      ["Bob", "strike:hand"], ["Alice", "strike:hand"],
      ["Bob", "pass"], ["Alice", "pass"], // damage
      ["Bob", "pass"], ["Alice", "pass"], // press
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // end of round
    ]);

    expect(state.seats[0]!.permanents.some((p) => p.card.id === "pm1")).toBe(true);
    expect(state.seats[1]!.permanents).toHaveLength(0);
  });
});

/** Alice controls the Cave and a Ministry vampire; Bob (her prey) has a
 *  small vampire and an ally. */
function caveGame(): GameState {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  v1.clan = "Ministry";
  v1.capacity = 8;
  state.seats[0]!.permanents.push(loc("cave", "Cave of Apples"));
  const bob = state.seats[1]!;
  bob.minions[0]!.capacity = 2; // W: younger than V1
  bob.minions[0]!.owner = "Bob";
  bob.minions[1]!.capacity = 9; // M: older, never eligible
  bob.minions[1]!.owner = "Bob";
  return state;
}

describe("Cave of Apples (100311)", () => {
  it("places a corruption counter with a directed action, below threshold", () => {
    const state = caveGame();
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "act:Cave of Apples:cave:corrupt:V1:W")).toBe(true);
    // Negative space: the older vampire is not "younger", and Carol is not
    // Alice's prey.
    expect(dp.options.some((o) => o.id.endsWith(":M"))).toBe(false);
    expect(dp.options.some((o) => o.id.endsWith(":N"))).toBe(false);

    runTrace(engine, [
      ["Alice", "act:Cave of Apples:cave:corrupt:V1:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolves
    ]);

    const w = state.seats[1]!.minions.find((m) => m.id === "W")!;
    expect(w.corruption?.["Alice"]).toBe(1);
    expect(w.controller).toBe("Bob"); // capacity 2 > 1 counter: no steal yet
    // A corruption action does not start combat, unlike a rush.
    expect(state.eventLog.some((e) => e.type === "CombatBegan")).toBe(false);
  });

  it("steals the minion once the counters reach its capacity", () => {
    const state = caveGame();
    state.seats[1]!.minions[0]!.corruption = { Alice: 1 }; // one short of 2
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "act:Cave of Apples:cave:corrupt:V1:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      // "You CAN burn those counters to steal" — a real choice now.
      ["Alice", "choice:Cave of Apples:cave:steal:W"],
    ]);

    expect(state.seats[1]!.minions.some((m) => m.id === "W")).toBe(false);
    const stolen = state.seats[0]!.minions.find((m) => m.id === "W")!;
    expect(stolen.controller).toBe("Alice");
    expect(stolen.owner).toBe("Bob"); // ownership never moves (p. 16)
    expect(stolen.corruption?.["Alice"] ?? 0).toBe(0); // counters burned
  });

  it("measures an ally by its cost, not its life", () => {
    const state = caveGame();
    const ally = makeAlly("AL", "Bob", 4);
    ally.cost = 1; // a 1-pool ally with 4 life
    ally.owner = "Bob";
    state.seats[1]!.minions.push(ally);
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "act:Cave of Apples:cave:corrupt:V1:AL"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "choice:Cave of Apples:cave:steal:AL"],
    ]);

    // 1 counter ≥ cost 1 → stolen straight away, despite 4 life.
    expect(state.seats[0]!.minions.some((m) => m.id === "AL")).toBe(true);
  });

  it("a blocked corruption action places nothing", () => {
    const state = caveGame();
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "act:Cave of Apples:cave:corrupt:V1:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // attempt → combat
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
      ["Alice", "pass"], ["Bob", "pass"], // damage
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    const w = state.seats[1]!.minions.find((m) => m.id === "W")!;
    expect(w.corruption?.["Alice"] ?? 0).toBe(0);
  });
});
