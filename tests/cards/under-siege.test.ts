/**
 * Under Siege (102063) — a +1 stealth action (titled Sabbat) that puts
 * itself in play with 3 counters. Once each action, a Sabbat vampire you
 * control burns 1 counter to unlock and attempt to block with +1 intercept.
 */

import { describe, expect, it } from "vitest";
import type { PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function underSiege(counters: number): PermanentInPlay {
  return {
    card: { id: "us1", name: "Under Siege" },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["Under Siege", "location"],
    counters,
  };
}

describe("Under Siege (102063)", () => {
  it("puts itself in play with 3 counters on a successful action", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.title = "bishop";
    v1.sect = "sabbat";
    state.seats[0]!.hand.push({ id: "us1", name: "Under Siege" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Under Siege:basic:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);

    const us = state.seats[0]!.permanents.find((p) => p.card.name === "Under Siege");
    expect(us).toBeDefined();
    expect(us!.counters).toBe(3);
  });

  it("a Sabbat vampire burns a counter to unlock and force-block", () => {
    const state = threeSeatGame();
    // Carol (Alice's predator) bleeds Alice; Alice's Sabbat M force-blocks.
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Carol";
    state.seats[2]!.minions[0]!.disciplines = {};
    const m = state.seats[0]!.minions[0]!;
    m.sect = "sabbat";
    m.locked = true;
    state.seats[0]!.minions.push(makeMinion("A2", "Alice")); // spare, not Sabbat
    state.seats[0]!.permanents.push(underSiege(3));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Carol", "bleed:N"],
      ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], // announce
      ["Carol", "pass"], // state A, acting first
      ["Alice", "ability:Under Siege:us1:V1"], // M(=V1) burns a counter + force-block
      ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], // block attempt → combat
    ]);

    expect(state.eventLog.some((e) => e.type === "MinionUnlocked" && e.minion === "V1")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "CombatBegan")).toBe(true);
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "us1")!.counters).toBe(2);
  });
});
