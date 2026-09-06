/**
 * Alamut (100037) — a counter location. Accumulate: after a Banu Haqim you
 * control successfully bleeds, add the pool lost as counters. Spend: during
 * polling, burn X counters for +X votes.
 */

import { describe, expect, it } from "vitest";
import type { PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function alamut(counters: number): PermanentInPlay {
  return { card: { id: "al1", name: "Alamut" }, locked: false, usedThisPhase: false, statics: {}, tags: ["location"], counters };
}

function politicalActionTrace(prefix: string): Array<[string, string]> {
  return [
    ["Alice", prefix],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ];
}

describe("Alamut (100037)", () => {
  it("gains counters equal to the pool lost when a Banu Haqim bleeds", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.clan = "Banu Haqim";
    v1.bleedAmount = 2;
    state.seats[0]!.permanents.push(alamut(0));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // effects
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // resolve
    ]);

    expect(state.seats[0]!.permanents.find((p) => p.card.id === "al1")!.counters).toBe(2);
  });

  it("burns counters during polling for votes", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(alamut(3));
    state.seats[0]!.hand.push({ id: "krc1", name: "Kine Resources Contested" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...politicalActionTrace("play:Kine Resources Contested"),
      ["Alice", "terms:Bob=2,Carol=2"],
      ["Alice", "ability:Alamut:al1:votes:2"], // burn 2 → +2 votes
      ["Alice", "vote:grant:for"],
      ["Alice", "pass"],
      ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ passed: true, votesFor: 2 });
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "al1")!.counters).toBe(1); // 3 − 2
  });
});
