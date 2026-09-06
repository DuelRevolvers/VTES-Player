/**
 * "Minions can burn this card as a Ⓓ action" (docs/granted-actions-design
 * .md §4.5) — the counter-play clause shared by ~25 cards, compiled from
 * `permanent.vulnerableTo`. Any Methuselah's minions may take the action;
 * it is directed at the card's controller, who alone may block; success
 * burns the card. Covered here on Creeping Sabotage (102213) and Army of
 * Rats (100093), which also drip 1 pool off the prey each unlock phase.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function entry(id: string, name: string): PermanentInPlay {
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: [name],
  };
}

/** Bob's minion phase, with Alice controlling the named card in play. */
function bobsMinionPhase(name: string, id = "cs1"): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") tf.seat = "Bob";
  state.seats[0]!.permanents.push(entry(id, name));
  return state;
}

/** Alice's unlock phase, so onControllerUnlock fires for her cards. */
function alicesUnlockPhase(): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.phase = "unlock";
    tf.unlockDone = false;
    tf.unlockAbilitiesDone = false;
  }
  return state;
}

describe("Creeping Sabotage (102213)", () => {
  it("burns 1 pool off the prey during its controller's unlock phase", () => {
    const state = alicesUnlockPhase();
    state.seats[0]!.permanents.push(entry("cs1", "Creeping Sabotage"));
    new VtesEngine(state, testRegistry).decision(); // settle runs the unlock phase

    expect(state.seats[1]!.pool).toBe(9); // Bob is Alice's prey
    expect(state.seats[2]!.pool).toBe(10);
  });

  it("an opponent's minion burns it as a directed action; only its controller may block", () => {
    const state = bobsMinionPhase("Creeping Sabotage");
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id === "act:Creeping Sabotage:cs1:burn:W")).toBe(true);

    runTrace(engine, [
      ["Bob", "act:Creeping Sabotage:cs1:burn:W"],
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // announce
      ["Bob", "pass"],
      ["Alice", "pass"], // the card's controller is the only seat offered a block
      ["Carol", "pass"],
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // C → resolves
    ]);

    const announced = state.eventLog.find((e) => e.type === "ActionAnnounced")!;
    expect(announced).toMatchObject({ target: "Alice", directed: true, acting: "W" });
    expect(state.seats[0]!.permanents).toHaveLength(0); // burned
    expect(
      state.eventLog.some((e) => e.type === "PermanentBurned" && e.cardId === "cs1"),
    ).toBe(true);
  });

  it("offers the block only to the card's controller, not to the prey/predator", () => {
    const state = bobsMinionPhase("Creeping Sabotage");
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("act:Creeping Sabotage:cs1:burn:W");
    for (const seat of ["Bob", "Alice", "Carol"]) {
      const dp = engine.decision()!;
      expect(dp.seat).toBe(seat);
      engine.choose("pass");
    }
    engine.choose("pass"); // Bob, state A
    const alice = engine.decision()!;
    expect(alice.seat).toBe("Alice");
    expect(alice.options.some((o) => o.id === "block:V1")).toBe(true);
    engine.choose("pass");
    // Carol is Bob's prey but not the target: no block option.
    const carol = engine.decision()!;
    expect(carol.seat).toBe("Carol");
    expect(carol.options.some((o) => o.id.startsWith("block:"))).toBe(false);
  });

  it("a blocked burn leaves the card in play", () => {
    const state = bobsMinionPhase("Creeping Sabotage");
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Bob", "act:Creeping Sabotage:cs1:burn:W"],
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

    expect(state.eventLog.find((e) => e.type === "ActionResolved")).toMatchObject({
      success: false,
    });
    expect(state.seats[0]!.permanents).toHaveLength(1); // survived
  });

  it("is one action per minion per copy per turn (p. 20)", () => {
    const state = bobsMinionPhase("Creeping Sabotage");
    // A second copy, so the spent one does not simply vanish from play.
    state.seats[0]!.permanents.push(entry("cs2", "Creeping Sabotage"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Bob", "act:Creeping Sabotage:cs1:burn:W"],
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"],
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"],
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"],
    ]);

    const dp = engine.decision()!;
    // W is locked now, but the OTHER minion may still burn the second copy —
    // the limit is per minion per copy, not per card.
    expect(dp.options.some((o) => o.id === "act:Creeping Sabotage:cs2:burn:M")).toBe(true);
    expect(dp.options.some((o) => o.id.endsWith(":W"))).toBe(false);
  });
});

describe("Army of Rats (100093)", () => {
  it("burns only 1 pool each turn no matter how many copies are in play", () => {
    const state = alicesUnlockPhase();
    state.seats[0]!.permanents.push(entry("ar1", "Army of Rats"));
    state.seats[0]!.permanents.push(entry("ar2", "Army of Rats"));
    new VtesEngine(state, testRegistry).decision(); // settle runs the unlock phase

    expect(state.seats[1]!.pool).toBe(9); // one pool, not two
  });

  it("still drips once for a single copy, and can be burned by a minion", () => {
    const state = bobsMinionPhase("Army of Rats", "ar1");
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Bob", "act:Army of Rats:ar1:burn:W"],
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"],
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"],
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"],
    ]);

    expect(state.seats[0]!.permanents).toHaveLength(0);
  });
});
