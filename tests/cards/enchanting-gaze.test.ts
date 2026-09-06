/**
 * Enchanting Gaze (102221) — superior: burn 1 of your corruption counters
 * from a blocking minion to fail its block (and it cannot block again).
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("Enchanting Gaze (102221)", () => {
  it("superior: burns corruption to fail a corrupted minion's block", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pre: "superior", pro: "superior" };
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.corruption = { Alice: 1 };
    state.seats[0]!.hand.push({ id: "eg1", name: "Enchanting Gaze" });
    const bobStart = state.seats[1]!.pool;
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "play:Enchanting Gaze:superior:V1"], // burn corruption → fail block
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt → forced fail
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A → C
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // resolve
    ]);

    expect(state.eventLog.some((e) => e.type === "BlockFailed" && e.blocker === "M")).toBe(true);
    expect(state.seats[1]!.minions.find((x) => x.id === "M")!.corruption?.["Alice"]).toBe(0);
    expect(state.seats[1]!.pool).toBe(bobStart - 1); // the bleed landed
  });
});
