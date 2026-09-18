/**
 * Events, the card type (docs/events-design.md).
 *
 * The Bitter and Sweet Story (100163), Hunger Moon (100944), Narrow Minds
 * (101265) — the first three events in the pool, and the machinery they
 * needed: p. 37's discard-phase action, one per phase, each event once
 * each game.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, handSizeOf } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id)!;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function entry(id: string, name: string): PermanentInPlay {
  const h = testRegistry[name];
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h?.permanentStatics ?? {},
    tags: h?.permanentTags ?? [],
  };
}

/** Alice, in her DISCARD phase, with `card` in hand. */
function discardPhase(card: string) {
  const state = threeSeatGame();
  state.seats[0]!.hand.push({ id: "ev", name: card });
  const tf = state.frames.find((f) => f.kind === "turn")!;
  if (tf.kind === "turn") {
    tf.phase = "discard";
    tf.discardActionsLeft = 1;
  }
  return { state, engine: new VtesEngine(state, testRegistry) };
}

// ---------------------------------------------------------------------------

describe("playing an event (p. 37)", () => {
  it("costs a DISCARD phase action, and the discard is gone with it", () => {
    const { state, engine } = discardPhase("Hunger Moon");
    const id = optionIds(engine).find((i) => i.includes("Hunger Moon"));
    expect(id).toBeDefined();
    // The discard option is there too — they compete for the same action.
    expect(optionIds(engine).some((i) => i.startsWith("discard:"))).toBe(true);
    runTrace(engine, [["Alice", id!]]);
    // A card put into play resolves after its as-played window, like any
    // other play.
    for (let i = 0; i < 4; i++) {
      const dp = engine.decision();
      if (!dp || dp.window !== "card.asPlayed") break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    expect(state.seats[0]!.permanents.some((p) => p.card.name === "Hunger Moon")).toBe(true);
    expect(optionIds(engine).some((i) => i.startsWith("discard:"))).toBe(false);
  });

  it("NEGATIVE SPACE: once each GAME, even after the card has gone", () => {
    const { state, engine } = discardPhase("Hunger Moon");
    runTrace(engine, [["Alice", optionIds(engine).find((i) => i.includes("Hunger Moon"))!]]);
    // A second copy, a later phase, and the first one no longer in play.
    state.seats[0]!.permanents.length = 0;
    state.seats[0]!.hand.push({ id: "ev2", name: "Hunger Moon" });
    const tf = state.frames.find((f) => f.kind === "turn")!;
    if (tf.kind === "turn") tf.discardActionsLeft = 1;
    expect(optionIds(engine).some((i) => i.includes("Hunger Moon"))).toBe(false);
  });
});

describe("The Bitter and Sweet Story (100163)", () => {
  it("gives EVERY Methuselah +2 hand size per victory point of their own", () => {
    const state = threeSeatGame();
    // One card, in Alice's play area.
    state.seats[0]!.permanents.push(entry("bs", "The Bitter and Sweet Story"));
    state.seats[0]!.victoryPoints = 1;
    state.seats[1]!.victoryPoints = 2;
    expect(handSizeOf(state, "Alice")).toBe(9);
    expect(handSizeOf(state, "Bob")).toBe(11);
    // …and nothing for a seat with none, which is the "of their own" half.
    expect(handSizeOf(state, "Carol")).toBe(7);
  });
});

describe("Hunger Moon (100944)", () => {
  it("takes a blood from any vampire that hunts", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(entry("hm", "Hunger Moon"));
    find(state, "V1").blood = 0; // 0 blood makes the hunt mandatory (p. 21)
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    // Hunted for 1 (capacity-capped), then the Moon took it back.
    const moon = state.seats[0]!.permanents.find((p) => p.card.id === "hm");
    expect(moon?.counters).toBe(1);
  });
});
