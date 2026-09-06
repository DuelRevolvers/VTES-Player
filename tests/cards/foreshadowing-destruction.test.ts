/**
 * Foreshadowing Destruction (100765) — "[DOM] +3 bleed if the target
 * Methuselah has 9 or fewer pool (limited)." Exercises the
 * targetPoolAtMost conditional bonus.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("Foreshadowing Destruction (100765)", () => {
  function bleedDrop(bobPool: number): number {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { dom: "superior" };
    v1.blood = 3;
    state.seats[1]!.pool = bobPool;
    state.seats[0]!.hand.push({ id: "fd1", name: "Foreshadowing Destruction" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "play:Foreshadowing Destruction:superior:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // its as-played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // effects
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // resolve
    ]);
    return bobPool - state.seats[1]!.pool;
  }

  it("adds +3 when the target has 9 or fewer pool: base 1 + 3 = 4", () => {
    expect(bleedDrop(9)).toBe(4);
  });

  it("adds nothing when the target has 10+ pool: base 1", () => {
    expect(bleedDrop(10)).toBe(1);
  });
});
