/**
 * Frenzy gate (docs/frenzy-design.md): the frenzy keyword tag, Rage of
 * Apedemak (hand strikes +N damage this combat, via +strength), and Terror
 * Frenzy (the opposing minion cannot maneuver / press / use equipment).
 */

import { describe, expect, it } from "vitest";
import type { PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function weapon(id: string, name: string): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: ["weapon"] };
}

/** Alice's V1 bleeds, M (Bob) blocks → combat, up to the before-range step. */
function toBeforeRange(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"],
    ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt
  ]);
}

describe("Rage of Apedemak (102336) — hand strikes +N damage", () => {
  it("adds +1 damage to the acting vampire's hand strike", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { ani: "basic" };
    v1.strength = 1;
    v1.blood = 5;
    v1.capacity = 5;
    state.seats[0]!.hand.push({ id: "ra1", name: "Rage of Apedemak" });
    const engine = new VtesEngine(state, testRegistry);
    toBeforeRange(engine);

    runTrace(engine, [
      ["Alice", "play:Rage of Apedemak:basic:V1"], // +1 strength this combat
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // its as-played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // finish before range
      ["Alice", "pass"], ["Bob", "pass"], // range → close
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"], // V1 hits M for strength 1+1 = 2
      ["Bob", "strike:hand"],
      ["Alice", "pass"], // V1 mends M's strike
      ["Bob", "pass"], // M takes 2
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    const dmg = state.eventLog.find((e) => e.type === "DamageInflicted" && e.minion === "M");
    expect(dmg).toMatchObject({ amount: 2 });
  });
});

describe("Terror Frenzy (101960) — opposing minion cannot use equipment", () => {
  it("removes the opposing minion's weapon strike option", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { ani: "basic" };
    v1.blood = 5;
    v1.capacity = 5;
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.attached.push(weapon("gun1", "Flamethrower"));
    state.seats[0]!.hand.push({ id: "tf1", name: "Terror Frenzy" });
    const engine = new VtesEngine(state, testRegistry);
    toBeforeRange(engine);

    runTrace(engine, [
      ["Alice", "play:Terror Frenzy:basic:V1"], // opposing M cannot use equipment
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // its as-played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // finish before range
      ["Alice", "pass"], ["Bob", "pass"], // range → close
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"], // V1 strikes; now M chooses
    ]);

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.startsWith("ability:Flamethrower"))).toBe(false);
    expect(dp.options.some((o) => o.id === "strike:hand")).toBe(true);
  });
});
