/**
 * Powerbase: Los Angeles (101435) — the discard phase action as a real
 * counter (p. 37: "you receive by default one discard phase action"),
 * +1 from locking this location, and the optional "unlock a ready Anarch"
 * rider when the extra action discards an Anarch-requiring card.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function la(): PermanentInPlay {
  return {
    card: { id: "la1", name: "Powerbase: Los Angeles" },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["location"],
  };
}

/** Alice's discard phase, holding an Anarch card and a plain one. */
function discardPhase(): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.phase = "discard";
    tf.discardActionsLeft = 1;
  }
  const alice = state.seats[0]!;
  alice.hand = [
    { id: "anarchCard", name: "Constant Revolution" }, // requires an Anarch
    { id: "plain", name: "Conditioning" },
  ];
  alice.library.push({ id: "lib1", name: "Conditioning" });
  alice.library.push({ id: "lib2", name: "Conditioning" });
  return state;
}

describe("the discard phase action (p. 37)", () => {
  it("allows exactly one discard by default", () => {
    const state = discardPhase();
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.options.filter((o) => o.id.startsWith("discard:"))).toHaveLength(2);

    engine.choose("discard:plain");
    // One action spent → the turn moves on; no second discard offered.
    const after = engine.decision()!;
    expect(after.window).not.toBe("turn.discard");
  });
});

describe("Powerbase: Los Angeles (101435)", () => {
  it("locks for a second discard phase action", () => {
    const state = discardPhase();
    state.seats[0]!.permanents.push(la());
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "ability:Powerbase: Los Angeles:la1:action"],
      ["Alice", "discard:plain"],
    ]);

    expect(state.seats[0]!.permanents[0]!.locked).toBe(true);
    // A second discard is still on the table (2 actions, 1 spent).
    const dp = engine.decision()!;
    expect(dp.window).toBe("turn.discard");
    expect(dp.options.some((o) => o.id.startsWith("discard:"))).toBe(true);
  });

  it("offers to unlock a ready Anarch after discarding an Anarch card", () => {
    const state = discardPhase();
    state.seats[0]!.permanents.push(la());
    const anarch = makeMinion("AN", "Alice", { sect: "anarch" });
    anarch.locked = true;
    state.seats[0]!.minions.push(anarch);
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "ability:Powerbase: Los Angeles:la1:action"],
      ["Alice", "discard:anarchCard"],
    ]);

    const dp = engine.decision()!;
    expect(dp.window).toBe("choice");
    expect(dp.seat).toBe("Alice");
    expect(dp.options.some((o) => o.id.endsWith("unlockAnarch:AN"))).toBe(true);
    expect(dp.options.some((o) => o.id === "pass")).toBe(true); // "you CAN"

    engine.choose("choice:Powerbase: Los Angeles:la1:unlockAnarch:AN");
    expect(state.seats[0]!.minions.find((m) => m.id === "AN")!.locked).toBe(false);
  });

  it("does not offer the unlock for a card that does not require an Anarch", () => {
    const state = discardPhase();
    state.seats[0]!.permanents.push(la());
    const anarch = makeMinion("AN", "Alice", { sect: "anarch" });
    anarch.locked = true;
    state.seats[0]!.minions.push(anarch);
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "ability:Powerbase: Los Angeles:la1:action"],
      ["Alice", "discard:plain"],
    ]);

    expect(engine.decision()!.window).not.toBe("choice");
    expect(state.seats[0]!.minions.find((m) => m.id === "AN")!.locked).toBe(true);
  });

  it("is stolen only by another Methuselah's Anarch", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    state.seats[0]!.permanents.push(la());
    state.seats[1]!.minions[0]!.sect = "anarch"; // W qualifies
    state.seats[1]!.minions[1]!.sect = "camarilla"; // M does not
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "act:Powerbase: Los Angeles:la1:steal:W")).toBe(true);
    expect(dp.options.some((o) => o.id === "act:Powerbase: Los Angeles:la1:steal:M")).toBe(false);
  });
});
