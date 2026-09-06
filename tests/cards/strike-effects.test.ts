/**
 * Strike-effects gate (docs/strike-effects-design.md): aggravated damage,
 * fixed-damage strikes, and steal-blood strikes.
 */

import { describe, expect, it } from "vitest";
import type { PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function enterCombat(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"],
    ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
}

const toStrikes: Array<[string, string]> = [
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
  ["Alice", "pass"], ["Bob", "pass"], // range → close
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
];

function entry(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [], ...over };
}

describe("Body Flare (100230) — aggravated damage", () => {
  it("sends a full-blood vampire to torpor without mending", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pro: "basic" };
    v1.blood = 3;
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.blood = 5;
    m.capacity = 5;
    state.seats[0]!.hand.push({ id: "bf1", name: "Body Flare" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ...toStrikes,
      ["Alice", "play:Body Flare:basic"], // 2 aggravated on M
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      ["Bob", "strike:hand"], // M's normal strike on V1
      ["Alice", "pass"], // V1 mends M's 1
      ["Bob", "pass"], // M takes 2 aggravated → straight to torpor
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    expect(m.inTorpor).toBe(true);
    expect(m.blood).toBe(5); // aggravated is never mended
    expect(state.eventLog.some((e) => e.type === "DamageMended" && e.minion === "M")).toBe(false);
  });

  it("burns an already-wounded vampire that cannot pay", () => {
    // V1 carries a retainer doing normal damage; normal wounds M first,
    // then Body Flare's aggravated burns the wounded, blood-less M.
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pro: "basic" };
    v1.blood = 4;
    v1.attached.push(
      entry("mc1", "Murder of Crows", {
        statics: { combatRoundDamage: { amount: 1, ranged: true } },
        life: 2,
      }),
    );
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.blood = 0;
    m.capacity = 3;
    state.seats[0]!.hand.push({ id: "bf1", name: "Body Flare" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ...toStrikes,
      ["Alice", "play:Body Flare:basic"], // 2 aggravated on M
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Bob", "strike:hand"],
      ["Alice", "pass"], // V1 mends M's hand strike
      ["Bob", "pass"], // M's crows-normal 1 → wounded → torpor
      ["Bob", "pass"], // M's aggravated 2, no blood → burned
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    expect(state.seats[1]!.minions.some((x) => x.id === "M")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "MinionBurned" && e.minion === "M")).toBe(true);
  });
});

describe("Theft of Vitae (101966) — steal blood", () => {
  it("moves blood from the victim to the striker, dealing no damage", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { tha: "superior" };
    v1.blood = 2;
    v1.capacity = 5;
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.blood = 3;
    state.seats[0]!.hand.push({ id: "tv1", name: "Theft of Vitae" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ...toStrikes,
      ["Alice", "play:Theft of Vitae:superior"], // steal 2
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      ["Bob", "strike:hand"], // M's hand strike (close): V1 takes 1
      ["Alice", "pass"], // V1 mends 1
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    expect(m.blood).toBe(1); // 3 − 2 stolen (no damage)
    expect(v1.blood).toBe(3); // 2 + 2 stolen − 1 mended
    expect(state.eventLog.some((e) => e.type === "DamageInflicted" && e.minion === "M")).toBe(false);
  });
});

describe("Walk of Flame (102139) — not usable in the first round", () => {
  it("is hidden in round 1 and offered from round 2", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { tha: "basic" };
    v1.blood = 4;
    state.seats[0]!.hand.push({ id: "wf1", name: "Walk of Flame" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, toStrikes);
    const dp1 = engine.decision()!;
    expect(dp1.window).toBe("combat.chooseStrike");
    expect(dp1.options.some((o) => o.id.startsWith("play:Walk of Flame"))).toBe(false);

    // Advance the frame to round 2 directly (a press credit is not needed
    // to exercise the round gate).
    const cf = state.frames.find((f) => f.kind === "combat")!;
    if (cf.kind !== "combat") throw new Error("no combat");
    cf.round = 2;
    const dp2 = engine.decision()!;
    expect(dp2.options.some((o) => o.id.startsWith("play:Walk of Flame"))).toBe(true);
  });
});
