/**
 * Thing (101972) — "+1 stealth action. Add 2 blood to a Gangrel in your
 * uncontrolled region." Exercises the clan filter on addUncontrolledBlood.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("Thing (101972)", () => {
  it("adds 2 blood to a Gangrel in the uncontrolled region, and offers only Gangrel", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.uncontrolled.push({ card: makeMinion("U", "Alice", { clan: "Gangrel", capacity: 5, blood: 0 }), counters: 0 });
    alice.uncontrolled.push({ card: makeMinion("X", "Alice", { clan: "Ventrue", capacity: 5, blood: 0 }), counters: 0 });
    alice.hand.push({ id: "th1", name: "Thing" });
    const engine = new VtesEngine(state, testRegistry);

    // Only the Gangrel (U) is a legal target; the Ventrue (X) is not.
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.startsWith("play:Thing:basic:V1:U"))).toBe(true);
    expect(ids.some((i) => i.startsWith("play:Thing:basic:V1:X"))).toBe(false);

    runTrace(engine, [
      ["Alice", "play:Thing:basic:V1:U"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);

    expect(alice.uncontrolled.find((u) => u.card.id === "U")!.counters).toBe(2);
  });
});
