/**
 * Unlock-and-attempt-to-block reactions (docs/unlock-and-block-design.md):
 * a locked vampire plays a reaction that unlocks it and forces a block on
 * the current action. Wave 1: Sense the Savage Way, Second Tradition:
 * Domain, Eagle's Sight, Guard Dogs (+ Rat's Warning, Sentry Signal share
 * the mechanic).
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("Sense the Savage Way (101717)", () => {
  it("a locked cap-7 vampire unlocks and forces a block → combat", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.disciplines = { dom: "basic" };
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.disciplines = { ani: "superior" };
    m.capacity = 7;
    m.locked = true;
    state.seats[1]!.hand.push({ id: "ssw1", name: "Sense the Savage Way" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], // state A
      ["Bob", "play:Sense the Savage Way:superior:M"], // M unlocks + forced block
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // reaction as-played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt → success
    ]);

    expect(state.eventLog.some((e) => e.type === "MinionUnlocked" && e.minion === "M")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "BlockDeclared" && e.blocker === "M")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "CombatBegan")).toBe(true);
    expect(m.locked).toBe(true); // a successful blocker is locked
  });
});

describe("Second Tradition: Domain (101706)", () => {
  it("block mode: burns 1 blood, unlocks, and blocks with +2 intercept", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.disciplines = { dom: "basic" };
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.title = "prince";
    m.blood = 3;
    m.locked = true;
    state.seats[1]!.hand.push({ id: "std1", name: "Second Tradition: Domain" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "play:Second Tradition: Domain:basic:M:block"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt
    ]);

    expect(state.eventLog.some((e) => e.type === "BloodBurned" && e.minion === "M" && e.amount === 1)).toBe(true);
    expect(state.eventLog.some((e) => e.type === "InterceptModified" && e.minion === "M" && e.delta === 2)).toBe(true);
    expect(state.eventLog.some((e) => e.type === "CombatBegan")).toBe(true);
  });
});

describe("Eagle's Sight (100598)", () => {
  it("superior: a non-eligible seat force-blocks, ignoring restrictions", () => {
    const state = threeSeatGame();
    // Alice → Bob → Carol. Alice bleeds Bob (Carol is neither prey nor
    // predator of the bleed), so Carol normally cannot block — Eagle's Sight
    // lets Carol's vampire block anyway.
    state.seats[0]!.minions[0]!.disciplines = { dom: "basic" };
    const n = state.seats[2]!.minions.find((x) => x.id === "N")!;
    n.disciplines = { aus: "superior" };
    state.seats[2]!.hand.push({ id: "es1", name: "Eagle's Sight" });
    const engine = new VtesEngine(state, testRegistry);

    // Normally Carol has no block option against a bleed on Bob.
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"],
      ["Carol", "play:Eagle's Sight:superior:N"], // force block ignoring restrictions
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt
    ]);

    expect(state.eventLog.some((e) => e.type === "BlockDeclared" && e.blocker === "N")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "CombatBegan")).toBe(true);
  });
});

describe("Guard Dogs (100863)", () => {
  it("unlocks a locked vampire so it can then block normally", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.disciplines = { dom: "basic" };
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.disciplines = { ani: "basic" };
    m.locked = true;
    state.seats[1]!.hand.push({ id: "gd1", name: "Guard Dogs" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "play:Guard Dogs:basic:M"], // unlocks M
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      ["Alice", "pass"], // impulse rewinds to acting; pass back to Bob
    ]);

    expect(state.eventLog.some((e) => e.type === "MinionUnlocked" && e.minion === "M")).toBe(true);
    // M is now unlocked and eligible: the normal block option is offered.
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id === "block:M")).toBe(true);
  });
});
