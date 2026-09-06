/**
 * Dead Pool (102299) — accumulate: a vampire in combat with your Lasombra
 * leaving the ready region adds a counter; spend: your Lasombra burns a
 * counter for +2 bleed (during its bleed) or +2 votes (during polling).
 */

import { describe, expect, it } from "vitest";
import type { PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function deadPool(counters: number): PermanentInPlay {
  return { card: { id: "dp1", name: "Dead Pool" }, locked: false, usedThisPhase: false, statics: {}, tags: [], counters };
}

describe("Dead Pool (102299)", () => {
  it("adds a counter when a vampire in combat with your Lasombra goes to torpor", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.clan = "Lasombra";
    v1.strength = 5;
    v1.blood = 5;
    v1.capacity = 5;
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.blood = 1;
    m.capacity = 1;
    state.seats[0]!.permanents.push(deadPool(0));
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
      ["Alice", "strike:hand"], // V1 hits M for 5
      ["Bob", "strike:hand"],
      ["Alice", "pass"], // V1 mends M's 1
      ["Bob", "pass"], // M takes 5 → torpor → combat ends immediately
      // "You CAN add a counter" — asked now, as a real choice.
      ["Alice", "choice:Dead Pool:dp1:addCounter:yes"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    expect(state.seats[1]!.minions.find((x) => x.id === "M")!.inTorpor).toBe(true);
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "dp1")!.counters).toBe(1);
  });

  it("lets the controller decline the counter", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.clan = "Lasombra";
    v1.strength = 5;
    v1.blood = 5;
    v1.capacity = 5;
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.blood = 1;
    m.capacity = 1;
    state.seats[0]!.permanents.push(deadPool(0));
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
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"], // decline the counter
    ]);

    expect(state.seats[0]!.permanents.find((p) => p.card.id === "dp1")!.counters).toBe(0);
  });

  it("burns a counter during a Lasombra's bleed for +2 bleed", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.clan = "Lasombra";
    state.seats[0]!.permanents.push(deadPool(1));
    const bobStart = state.seats[1]!.pool;
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "ability:Dead Pool:dp1:bleed"], // burn a counter → +2 bleed
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // effects
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // resolve
    ]);

    expect(state.seats[1]!.pool).toBe(bobStart - 3); // base 1 + 2
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "dp1")!.counters).toBe(0);
  });
});
