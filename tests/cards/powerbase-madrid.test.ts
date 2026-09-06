/**
 * Powerbase: Madrid (101437) — a counter location. Accumulate: once per
 * unlock phase (≤3 counters) add 1. Spend: lock during polling to grant +1
 * vote per counter (needs a titled Sabbat you control).
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function powerbase(counters: number): PermanentInPlay {
  return {
    card: { id: "pm1", name: "Powerbase: Madrid" },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["location"],
    counters,
  };
}

function politicalActionTrace(cardPrefix: string): Array<[string, string]> {
  return [
    ["Alice", cardPrefix],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ];
}

describe("Powerbase: Madrid (101437)", () => {
  it("adds a counter once during the unlock phase, and not twice", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "unlock";
      tf.unlockDone = false;
      tf.unlockAbilitiesDone = false;
    }
    state.seats[0]!.permanents.push(powerbase(0));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "ability:Powerbase: Madrid:pm1:add"]]);
    const pm = state.seats[0]!.permanents.find((p) => p.card.id === "pm1")!;
    expect(pm.counters).toBe(1);

    // Spent for the phase: no second add offered.
    const dp = engine.decision()!;
    const ids = dp.seat === "Alice" ? dp.options.map((o) => o.id) : [];
    expect(ids.some((i) => i.startsWith("ability:Powerbase: Madrid:pm1:add"))).toBe(false);
  });

  it("locks during polling to grant +1 vote per counter", () => {
    const state: GameState = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.title = "bishop"; // titled Sabbat recipient
    v1.sect = "sabbat";
    state.seats[0]!.permanents.push(powerbase(2));
    state.seats[0]!.hand.push({ id: "krc1", name: "Kine Resources Contested" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...politicalActionTrace("play:Kine Resources Contested"),
      ["Alice", "terms:Bob=2,Carol=2"],
      ["Alice", "ability:Powerbase: Madrid:pm1:votes"], // lock → +2 votes
      ["Alice", "vote:grant:for"],
      ["Alice", "pass"],
      ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ passed: true, votesFor: 2 });
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "pm1")!.locked).toBe(true);
  });
});
