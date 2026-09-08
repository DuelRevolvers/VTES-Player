/**
 * WHICH VAMPIRE'S DISCIPLINES DECIDE THE LEVEL (owner question
 * 2026-09-07: "there were multiple times when I should've been able to
 * play a Superior action from a card in my hand, because I had a Vampire
 * with that Superior ability but it only had Basic available … sometimes
 * I could, and other times I could not").
 *
 * The answer is a rule, not a bug: a card is played BY a minion, and the
 * Disciplines that count are that minion's. Holding a superior somewhere
 * else at the table does nothing for the vampire actually playing it, so
 * the same card in the same hand is offered at superior on one turn and
 * only at inferior on the next, depending on who is acting.
 *
 * Slam is the fixture because it is the plainest case in the pool: one
 * discipline, one clause at each level, no timing riders.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** The Slam plays the engine is offering right now, by level. */
function slamModes(engine: VtesEngine): string[] {
  return (engine.decision()?.options ?? [])
    .flatMap((o) =>
      o.kind === "playCard" && o.name === "Slam" ? [`${o.mode}:${o.minion}`] : [],
    )
    .sort();
}

/** A game where V1 strikes M, with V1's Potence at the given level. */
function combatWith(level: "basic" | "superior"): VtesEngine {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  v1.disciplines = { pot: level };
  v1.strength = 1;
  v1.blood = 5;
  v1.capacity = 5;
  // A SECOND vampire who holds Potence at superior, and is not in this
  // combat. This is the whole point of the fixture: the owner's "I had a
  // Vampire with that Superior ability" is this one, and it must not
  // change what V1 may play.
  const v2 = state.seats[0]!.minions[1];
  if (v2) {
    v2.disciplines = { pot: "superior" };
    v2.blood = 5;
    v2.capacity = 5;
  }
  const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
  m.blood = 5;
  m.capacity = 5;
  state.seats[0]!.hand.push({ id: "sl1", name: "Slam" });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"],
    ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  return engine;
}

describe("a card's superior mode follows the ACTING vampire", () => {
  it("offers BOTH levels when the vampire playing it has the superior", () => {
    // The positive control. Without this, the assertion below could pass
    // because superior is never offered to anybody, ever.
    expect(slamModes(combatWith("superior"))).toEqual(["basic:V1", "superior:V1"]);
  });

  it("offers only the inferior when that vampire has it at basic", () => {
    // …even though V2, standing right there, has Potence at superior.
    // That is the rule, and it is the answer to the owner's question.
    expect(slamModes(combatWith("basic"))).toEqual(["basic:V1"]);
  });

  it("is not offered at all to a vampire without the discipline", () => {
    const engine = combatWith("basic");
    const state = engine.state;
    const v1 = state.seats[0]!.minions.find((m) => m.id === "V1")!;
    v1.disciplines = {};
    expect(slamModes(engine)).toEqual([]);
  });
});
