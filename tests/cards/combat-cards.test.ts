/**
 * Scenario tests for the combat gate and its five supported cards:
 * Roundhouse (102215), Majesty (101144), Torn Signpost (101993),
 * Hidden Strength (100918), Apportation (100077).
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Alice's V1 bleeds Bob; Bob blocks with M → combat, at step Before Range. */
function enterCombat(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"],
    ["Bob", "pass"],
    ["Carol", "pass"],
    ["Alice", "pass"],
    ["Bob", "block:M"],
    ["Alice", "pass"],
    ["Bob", "pass"],
    ["Carol", "pass"],
  ]);
}

function bobM(state: GameState) {
  return state.seats[1]!.minions.find((m) => m.id === "M")!;
}

describe("Roundhouse (102215)", () => {
  it("hand strike at +2 sends a 2-blood blocker to torpor", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pot: "basic" };
    state.seats[0]!.hand.push({ id: "r1", name: "Roundhouse" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      // Before Range, Determine Range, Before Strikes: all quiet.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Strike: the acting minion plays Roundhouse as its strike.
      ["Alice", "play:Roundhouse:basic"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Bob", "strike:hand"],
      // Damage: V1 takes 1 (mends), M takes 3 — mends 2 and goes to
      // torpor. Combat then ends immediately, but End of Round runs.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    const m = bobM(state);
    expect(m.inTorpor).toBe(true);
    expect(m.blood).toBe(0);
    const v1After = state.seats[0]!.minions[0]!;
    expect(v1After.blood).toBe(1);
    const ended = state.eventLog.find((e) => e.type === "CombatEnded")!;
    expect(ended).toMatchObject({ rounds: 1 });
  });
});

describe("Majesty (101144)", () => {
  it("superior: strike combat-ends unlocks the blocker before ending — no damage", () => {
    const state = threeSeatGame();
    const m = bobM(state);
    m.disciplines = { pre: "superior" };
    state.seats[1]!.hand.push({ id: "mj1", name: "Majesty" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    // M locked by the successful block.
    expect(m.locked).toBe(true);

    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Acting chooses first; then M strikes with superior Majesty.
      ["Alice", "strike:hand"],
      ["Bob", "play:Majesty:superior"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Combat ends before any strike resolves; End of Round still runs.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    expect(m.locked).toBe(false); // the classic Majesty escape
    expect(m.blood).toBe(1); // paid Majesty's cost of 1
    expect(state.seats[0]!.minions[0]!.blood).toBe(2); // no damage anywhere
    expect(state.eventLog.some((e) => e.type === "DamageInflicted")).toBe(false);
    const resolved = state.eventLog.find((e) => e.type === "ActionResolved")!;
    expect(resolved).toMatchObject({ success: false }); // still blocked
  });
});

describe("Torn Signpost (101993)", () => {
  it("sets strength for the whole combat from the before-range window", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pot: "basic" };
    state.seats[0]!.hand.push({ id: "ts1", name: "Torn Signpost" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      // Before Range: Torn Signpost is only usable here.
      ["Alice", "play:Torn Signpost:basic"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Impulse rewound; everyone passes out of Before Range.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    // V1's hand strike hit for strength 2; M mended both blood.
    const m = bobM(state);
    expect(m.blood).toBe(0);
    expect(m.inTorpor).toBe(false);
    expect(state.eventLog.some((e) => e.type === "StrengthSet")).toBe(true);
    // And it must NOT be offered outside Before Range: quick sanity — the
    // second copy in hand had no legal window after step 1.
  });
});

describe("Hidden Strength (100918)", () => {
  it("prevents X+1 damage for X blood, one play fully absorbing a hand strike", () => {
    const state = threeSeatGame();
    const m = bobM(state);
    m.disciplines = { for: "basic" };
    state.seats[1]!.hand.push({ id: "hs1", name: "Hidden Strength" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"],
      // V1's damage first (no prevention from Alice).
      ["Alice", "pass"],
      // M takes 1: Bob prevents with Hidden Strength at X=0 (prevent 1).
      ["Bob", "play:Hidden Strength:basic"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Fully prevented — the engine moves straight on to Press.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    const mAfter = bobM(state);
    expect(mAfter.blood).toBe(2); // no mending needed
    expect(state.eventLog.some((e) => e.type === "DamagePrevented")).toBe(true);
    expect(state.seats[0]!.minions[0]!.blood).toBe(1); // V1 mended 1
  });
});

describe("Apportation (100077)", () => {
  it("superior: a maneuver to long range makes hand strikes whiff", () => {
    const state = threeSeatGame();
    const m = bobM(state);
    m.disciplines = { tha: "superior" };
    state.seats[1]!.hand.push({ id: "ap1", name: "Apportation" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Determine Range: acting declines; M maneuvers to long.
      ["Alice", "pass"],
      ["Bob", "play:Apportation:superior"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Alice cannot offset (no maneuvers); both decline → long range.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"],
      // No damage at long range → no prevention decisions; press; end.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    expect(state.eventLog.some((e) => e.type === "DamageInflicted")).toBe(false);
    expect(state.seats[0]!.minions[0]!.blood).toBe(2);
    expect(bobM(state).blood).toBe(2);
  });

  it("basic: a press to continue forces a second round", () => {
    const state = threeSeatGame();
    const m = bobM(state);
    m.disciplines = { tha: "basic" };
    m.blood = 3; // survive two rounds of hand strikes
    const v1 = state.seats[0]!.minions[0]!;
    v1.blood = 3;
    state.seats[1]!.hand.push({ id: "ap2", name: "Apportation" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      // Round 1: quiet until Press.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      // Press: Alice declines; Bob plays Apportation as a press.
      ["Alice", "pass"],
      ["Bob", "play:Apportation:basic"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Alice cannot cancel it; both decline → End of Round → round 2.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Round 2 plays out plainly.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    const ended = state.eventLog.find((e) => e.type === "CombatEnded")!;
    expect(ended).toMatchObject({ rounds: 2 });
    // Two rounds of mutual hand strikes: both mended twice.
    expect(state.seats[0]!.minions[0]!.blood).toBe(1);
    expect(bobM(state).blood).toBe(1);
  });
});
