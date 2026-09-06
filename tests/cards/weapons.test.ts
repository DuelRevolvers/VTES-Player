/**
 * Weapons gate (docs/weapons-design.md): the generic data-driven weapon
 * shape — guns (fixed ranged damage) and melee (strength-based),
 * optionally aggravated, optional per-combat maneuver.
 */

import { describe, expect, it } from "vitest";
import type { PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function weapon(id: string, name: string): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: ["weapon"] };
}

/** Alice's V1 bleeds, M (Bob) blocks → combat. M carries the weapon. */
function combatWithArmedBlocker(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"],
    ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
}

const toStrikesNoManeuver: Array<[string, string]> = [
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
  ["Alice", "pass"], ["Bob", "pass"], // range → close
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
];

describe("Flamethrower (100742) — aggravated gun", () => {
  it("strikes for 2R aggravated, sending a full-blood attacker to torpor", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.blood = 5;
    v1.capacity = 5;
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.attached.push(weapon("ft1", "Flamethrower"));
    const engine = new VtesEngine(state, testRegistry);
    combatWithArmedBlocker(engine);

    runTrace(engine, [
      ...toStrikesNoManeuver,
      ["Alice", "strike:hand"],
      ["Bob", "ability:Flamethrower:ft1:strike"], // M strikes V1 for 2R aggravated
      ["Alice", "pass"], // V1's aggravated resolves → torpor
      ["Bob", "pass"], // M mends V1's 1 hand strike
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    expect(v1.inTorpor).toBe(true);
    expect(v1.blood).toBe(5); // aggravated not mended
  });
});

describe("Femur of Toomler (100720) — melee strength+1 aggravated", () => {
  it("strikes for strength+1 at close range", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.blood = 5;
    v1.capacity = 5;
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.strength = 2; // strength+1 = 3 aggravated
    m.attached.push(weapon("fm1", "Femur of Toomler"));
    const engine = new VtesEngine(state, testRegistry);
    combatWithArmedBlocker(engine);

    runTrace(engine, [
      ...toStrikesNoManeuver,
      ["Alice", "strike:hand"],
      ["Bob", "ability:Femur of Toomler:fm1:strike"], // M strikes V1 for 3 aggravated
      ["Alice", "pass"], // V1 takes 3 aggravated → torpor
      ["Bob", "pass"], // M mends V1's 1 hand strike
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    const dmg = state.eventLog.find(
      (e) => e.type === "DamageInflicted" && e.minion === "V1" && e.aggravated,
    );
    expect(dmg).toMatchObject({ amount: 3 });
    expect(v1.inTorpor).toBe(true);
  });
});

describe("Assault Rifle (100107) — gun with a per-combat maneuver", () => {
  it("maneuvers to long and strikes for 4R", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.blood = 5;
    v1.capacity = 5;
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.attached.push(weapon("ar1", "Assault Rifle"));
    const engine = new VtesEngine(state, testRegistry);
    combatWithArmedBlocker(engine);

    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"],
      ["Bob", "ability:Assault Rifle:ar1:maneuver"], // → long, commits the gun
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"], // whiffs at long
      ["Bob", "ability:Assault Rifle:ar1:strike"], // 4R at long
      ["Alice", "pass"], // V1 takes 4 → mends 4
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    expect(v1.blood).toBe(1); // 5 − 4 mended
    expect(state.eventLog.some((e) => e.type === "RangeSet" && e.range === "long")).toBe(true);
  });
});
