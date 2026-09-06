/**
 * Counter sinks (docs/counter-sinks-design.md) — cards that spend a
 * counter *instead of* something the game would otherwise do, and burn
 * themselves when empty. Visit from the Capuchin (102126) pays for
 * replacement draws; its two clauses balance, so the hand and the hand
 * size fall together and nothing is ever discarded down.
 */

import { describe, expect, it } from "vitest";
import type { CardInstance, GameState } from "../../src/engine/index.ts";
import { handSizeOf, VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Alice's master phase, with a stocked library to draw from. */
function game(): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.phase = "master";
    tf.masterActionsLeft = 1;
  }
  const library: CardInstance[] = [];
  for (let i = 0; i < 20; i++) library.push({ id: `lib${i}`, name: "Deflection" });
  state.seats[0]!.library = library;
  return state;
}

function capuchin(state: GameState) {
  return state.seats[0]!.permanents.find((p) => p.card.name === "Visit from the Capuchin");
}

/** Put it in play through its master phase play, as-played window included. */
function play(state: GameState): VtesEngine {
  state.seats[0]!.hand.push({ id: "cap", name: "Visit from the Capuchin" });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "play:Visit from the Capuchin"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
  ]);
  return engine;
}

describe("Visit from the Capuchin (102126)", () => {
  it("arrives with 4 counters and draws the hand up by 4", () => {
    const state = game();
    play(state);

    expect(capuchin(state)?.counters).toBe(4);
    expect(handSizeOf(state, "Alice")).toBe(11); // 7 + 1 per counter
    // The hand is drawn straight up to the new size (p. 7).
    expect(state.seats[0]!.hand.length).toBe(11);
  });

  it("burns a counter instead of replacing a played card", () => {
    const state = game();
    const engine = play(state);
    const handBefore = state.seats[0]!.hand.length;
    const libBefore = state.seats[0]!.library.length;

    // End the master phase and bleed, playing nothing — then discard, which
    // is the next thing that would replace a card.
    runTrace(engine, [
      ["Alice", "pass"], // end master phase
      ["Alice", "end"], // end minion phase
      ["Alice", "pass"], // end influence phase
    ]);
    const dp = engine.decision()!;
    expect(dp.window).toBe("turn.discard");
    engine.choose(dp.options.find((o) => o.id.startsWith("discard:"))!.id);

    // The discard-phase discard would draw a replacement; the counter went
    // instead, so the library is untouched and the hand is one smaller.
    expect(capuchin(state)?.counters).toBe(3);
    expect(state.seats[0]!.library.length).toBe(libBefore);
    expect(state.seats[0]!.hand.length).toBe(handBefore - 1);
    // …and the hand size fell with it, so nothing is owed either way.
    expect(handSizeOf(state, "Alice")).toBe(10);
  });

  it("burns itself when the last counter goes", () => {
    const state = game();
    state.seats[0]!.hand.push({ id: "cap", name: "Visit from the Capuchin" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Visit from the Capuchin"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    // Drain it directly: four replacements is four counters.
    const entry = capuchin(state)!;
    for (let i = 0; i < 4; i++) engine.discardFromHand("Alice", state.seats[0]!.hand[0]!.id);

    expect(entry.counters).toBe(0);
    expect(capuchin(state)).toBeUndefined();
    expect(handSizeOf(state, "Alice")).toBe(7);
  });

  it("does not intercept extra draws, only replacements", () => {
    const state = game();
    const engine = play(state);
    const libBefore = state.seats[0]!.library.length;

    // "Draw 2 cards" is not a replacement (the op says so itself).
    engine.drawCards("Alice", 2);

    expect(capuchin(state)?.counters).toBe(4);
    expect(state.seats[0]!.library.length).toBe(libBefore - 2);
  });

  it("is another Methuselah's business only when they control it", () => {
    const state = game();
    play(state);
    const libBefore = state.seats[1]!.library.length;
    const engine = new VtesEngine(state, testRegistry);
    state.seats[1]!.library.push({ id: "blib", name: "Deflection" });

    engine.discardFromHand("Bob", state.seats[1]!.hand[0]!.id);

    // Bob replaces normally; Alice's counters are hers.
    expect(capuchin(state)?.counters).toBe(4);
    expect(state.seats[1]!.library.length).toBe(libBefore);
  });
});
