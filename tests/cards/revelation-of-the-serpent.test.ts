/**
 * Revelation of the Serpent (102233) — superior: +1 bleed, and on a
 * successful bleed burn 2 of your corruption from a minion of the target to
 * unlock the acting vampire.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("Revelation of the Serpent (102233)", () => {
  it("superior: +1 bleed, then burns 2 corruption to unlock the vampire", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pre: "superior", pro: "superior" };
    v1.blood = 3;
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.corruption = { Alice: 2 };
    state.seats[0]!.hand.push({ id: "rs1", name: "Revelation of the Serpent" });
    const bobStart = state.seats[1]!.pool;
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "play:Revelation of the Serpent:superior:V1:bleed"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // its as-played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // effects
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // resolve
    ]);

    expect(state.seats[1]!.pool).toBe(bobStart - 2); // base 1 + 1
    expect(state.seats[1]!.minions.find((x) => x.id === "M")!.corruption?.["Alice"]).toBe(0);
    expect(state.seats[0]!.minions[0]!.locked).toBe(false); // unlocked
  });
});
