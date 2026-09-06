/**
 * Dodge & additional strikes (docs/dodge-additional-strikes-design.md):
 * kernel behaviors (a dodge cancels the opposing strike but not retainer
 * damage or combat-ends; additional strikes run extra sub-rounds) plus the
 * 8-card wave.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** V1 (Alice, acting) bleeds Bob; M (Bob) blocks → combat, at Before Range. */
function enterCombat(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"],
    ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
}

/** Advance Before Range → Determine Range → Before Strikes (all quiet), to
 *  the choose-strike step. */
const toStrikes: Array<[string, string]> = [
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
  ["Alice", "pass"], ["Bob", "pass"], // range → close
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
];

function entry(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [], ...over };
}

function bobM(state: GameState) {
  return state.seats[1]!.minions.find((m) => m.id === "M")!;
}

describe("dodge (kernel)", () => {
  it("negates the opposing hand strike, dealing and taking no damage", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { cel: "basic" };
    v1.blood = 3;
    const m = bobM(state);
    m.blood = 3;
    state.seats[0]!.hand.push({ id: "ss1", name: "Side Strike" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ...toStrikes,
      ["Alice", "play:Side Strike:basic"], // V1 dodges
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      ["Bob", "strike:hand"],
      // No damage either way → straight to press.
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    expect(v1.blood).toBe(3); // dodged M's strike
    expect(m.blood).toBe(3); // V1's dodge dealt nothing
    expect(state.eventLog.some((e) => e.type === "DamageInflicted")).toBe(false);
  });

  it("does not protect against retainer (environmental) damage", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { cel: "basic" };
    v1.blood = 3;
    const m = bobM(state);
    m.attached.push(
      entry("mc1", "Murder of Crows", {
        statics: { combatRoundDamage: { amount: 1, ranged: true } },
        life: 2,
      }),
    );
    state.seats[0]!.hand.push({ id: "ss1", name: "Side Strike" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ...toStrikes,
      ["Alice", "play:Side Strike:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Bob", "strike:hand"],
      ["Alice", "pass"], // V1 mends the crows' 1 (dodge did not stop it)
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    expect(v1.blood).toBe(2); // took the crows' 1 despite dodging
  });

  it("does not stop a combat-ends strike", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { cel: "basic" };
    const m = bobM(state);
    m.disciplines = { pre: "basic" };
    m.blood = 3;
    state.seats[0]!.hand.push({ id: "ss1", name: "Side Strike" });
    state.seats[1]!.hand.push({ id: "mj1", name: "Majesty" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ...toStrikes,
      ["Alice", "play:Side Strike:basic"], // V1 dodges
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Bob", "play:Majesty:basic"], // M: strike combat ends
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    // Combat ended despite the dodge (dodge only cancels the strike's
    // effects on the dodger, not combat-ends).
    expect(state.eventLog.some((e) => e.type === "CombatEnded")).toBe(true);
  });
});

describe("Blur (100227) — additional strikes", () => {
  it("superior grants 2 additional strikes, run after the normal pair", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { cel: "superior" };
    v1.blood = 4;
    const m = bobM(state);
    m.blood = 5;
    m.capacity = 5;
    state.seats[0]!.hand.push(
      { id: "bl1", name: "Blur" },
      { id: "bl2", name: "Blur" },
    );
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ...toStrikes,
      ["Alice", "play:Blur:superior"], // grant 2 additional strikes
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
    ]);
    // A second Blur this round is refused (one limited source per round).
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.chooseStrike");
    expect(dp.seat).toBe("Alice");
    expect(dp.options.some((o) => o.id.startsWith("play:Blur"))).toBe(false);

    runTrace(engine, [
      ["Alice", "strike:hand"], // V1's normal strike
      ["Bob", "strike:hand"], // M's normal strike
      ["Alice", "pass"], // V1 mends M's 1
      ["Bob", "pass"], // M mends V1's 1
      // Additional sub-round 1 (only V1 has additional strikes):
      ["Alice", "strike:hand"],
      ["Bob", "pass"], // M mends
      // Additional sub-round 2:
      ["Alice", "strike:hand"],
      ["Bob", "pass"], // M mends
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    // M took 3 hand strikes of 1 (normal + 2 additional), mended each.
    expect(m.blood).toBe(2); // 5 − 3
  });
});

describe("Quickness (101532) — limited vs non-limited", () => {
  it("the non-limited superior does not spend the limited source", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { cel: "superior" };
    v1.blood = 4;
    const m = bobM(state);
    m.blood = 5;
    m.capacity = 5;
    state.seats[0]!.hand.push(
      { id: "q1", name: "Quickness" },
      { id: "bl1", name: "Blur" },
    );
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ...toStrikes,
      ["Alice", "play:Quickness:superior"], // +1 additional, NOT limited
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    // Blur (a limited source) is still available; a second Quickness is not
    // (one Quickness per round).
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Blur"))).toBe(true);
    expect(dp.options.some((o) => o.id.startsWith("play:Quickness"))).toBe(false);
  });
});

describe("Lightning Reflexes (101107) — burn X for X strikes", () => {
  it("superior enumerates X by available blood", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { cel: "superior" };
    v1.blood = 3; // pays 1 for the card, leaving 2 → X ∈ {1, 2}
    state.seats[0]!.hand.push({ id: "lr1", name: "Lightning Reflexes" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, toStrikes);
    const dp = engine.decision()!;
    const xs = dp.options
      .filter((o) => o.id.startsWith("play:Lightning Reflexes:superior"))
      .map((o) => o.id);
    expect(xs.length).toBe(2); // X = 1 and X = 2
  });
});

describe("Side Strike / Wind Dance / Arms of Ahriman — dodge + strikes", () => {
  it("Wind Dance superior dodges, and the additional strike is FORCED to a dodge", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { tha: "superior" };
    v1.blood = 4;
    const m = bobM(state);
    m.blood = 4;
    m.capacity = 4;
    state.seats[0]!.hand.push({ id: "wd1", name: "Wind Dance" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ...toStrikes,
      ["Alice", "play:Wind Dance:superior"], // V1 dodges + gains 1 additional
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      ["Bob", "strike:hand"], // M's normal strike (dodged by V1)
    ]);

    // "1 additional strike: DODGE" — the extra sub-round offers exactly
    // that strike and nothing else. Until 2026-09-03 this was modelled as
    // a free-choice additional strike, which let the card deal damage it
    // does not print (docs/ledger-closeout.md §3).
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    expect(dp.options.map((o) => o.id)).toContain("strike:dodge");
    expect(dp.options.some((o) => o.id === "strike:hand")).toBe(false);

    runTrace(engine, [
      ["Alice", "strike:dodge"],
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    expect(v1.blood).toBe(4); // dodged M's strike
    // A dodge inflicts nothing, so M is untouched — the whole point of
    // the fix: the card grants evasion, not a second attack.
    expect(m.blood).toBe(4);
  });
});

describe("Pursuit / Shadow Shift — maneuver or additional strike", () => {
  it("Shadow Shift superior is a maneuver; basic grants an additional strike", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { obl: "superior" };
    state.seats[0]!.hand.push({ id: "sh1", name: "Shadow Shift" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    // Before range: both quiet. Range step: V1 may maneuver with Shadow Shift.
    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "play:Shadow Shift:superior"], // maneuver → long
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
    ]);
    expect(state.eventLog.some((e) => e.type === "RangeSet" && e.range === "long")).toBe(true);
  });
});
