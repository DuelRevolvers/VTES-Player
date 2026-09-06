/**
 * Post-block-resolution unlock (docs/unlock-and-block-design.md): "a locked
 * vampire who has blocked, after block resolution: unlock it" — modeled as
 * the first window of the combat a successful block produced (Cats'
 * Guidance) — plus Forced Vigilance's "unlock during a directed action".
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("Cats' Guidance (100308)", () => {
  it("basic: unlocks the vampire that blocked, in the resulting combat", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.disciplines = { dom: "basic" };
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.disciplines = { ani: "basic" };
    state.seats[1]!.hand.push({ id: "cg1", name: "Cats' Guidance" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt → combat
      ["Alice", "pass"], // combat.beforeRange, acting first
      ["Bob", "play:Cats' Guidance:basic:M"], // unlock the blocker
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
    ]);

    expect(state.eventLog.some((e) => e.type === "CombatBegan")).toBe(true);
    // The blocker (locked by blocking) is unlocked again.
    expect(state.seats[1]!.minions.find((x) => x.id === "M")!.locked).toBe(false);
    expect(state.eventLog.some((e) => e.type === "MinionUnlocked" && e.minion === "M")).toBe(true);
  });
});

describe("Forced Vigilance (100762)", () => {
  it("superior: unlocks a locked vampire during a directed action so it can block", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.disciplines = { dom: "basic" };
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.disciplines = { for: "superior" };
    m.blood = 2;
    m.locked = true;
    state.seats[1]!.hand.push({ id: "fv1", name: "Forced Vigilance" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "play:Forced Vigilance:superior:M"], // unlock M
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      ["Alice", "pass"], // impulse rewinds; pass back to Bob
    ]);

    expect(state.eventLog.some((e) => e.type === "MinionUnlocked" && e.minion === "M")).toBe(true);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id === "block:M")).toBe(true);
  });
});
