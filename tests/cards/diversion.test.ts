/**
 * Diversion (100563) — "Requires an Anarch." Three per-discipline modes:
 * [cel] additional strike, [for] prevent 2, [tha] ranged steal-blood with a
 * maneuver. Exercises per-discipline variants + the combat requiresSect
 * gate.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("Diversion (100563)", () => {
  it("[for] prevents 2 damage — but only for an Anarch", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { for: "basic" };
    v1.sect = "anarch";
    v1.blood = 5;
    v1.capacity = 5;
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.strength = 3;
    state.seats[0]!.hand.push({ id: "dv1", name: "Diversion" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range → close
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"], // M hits V1 for 3
      // Damage resolution: V1 (acting) resolves first, prevents 2 of the 3.
      ["Alice", "play:Diversion:basic:V1:for"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // its as-played
      ["Alice", "pass"], // V1 mends the remaining 1
      ["Bob", "pass"], // M mends V1's hand strike
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    expect(
      state.eventLog.some((e) => e.type === "DamagePrevented" && e.minion === "V1" && e.amount === 2),
    ).toBe(true);
    expect(v1.blood).toBe(4); // 5 − (3 − 2 prevented) mended back = took 1, mended 1
  });

  it("is not offered to a non-Anarch", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { for: "basic" };
    v1.sect = "camarilla";
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.strength = 3;
    state.seats[0]!.hand.push({ id: "dv1", name: "Diversion" });
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
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"],
    ]);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Diversion"))).toBe(false);
  });
});
