/**
 * Slam (101798) — "[pot] Strike: hand strike at +2 damage." A
 * strikeHandBonus combat card (superior adds a maneuver rider).
 */

import { describe, expect, it } from "vitest";
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

describe("Slam (101798)", () => {
  it("strikes for strength + 2 damage", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pot: "basic" };
    v1.strength = 1;
    v1.blood = 5;
    v1.capacity = 5;
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.blood = 5;
    m.capacity = 5;
    state.seats[0]!.hand.push({ id: "sl1", name: "Slam" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ...toStrikes,
      ["Alice", "play:Slam:basic:V1"], // V1's strike: hand at +2 → 3 damage
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      ["Bob", "strike:hand"],
      ["Alice", "pass"], // V1 mends M's hand strike
      ["Bob", "pass"], // M takes 3 → mends 3
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    const dmg = state.eventLog.find(
      (e) => e.type === "DamageInflicted" && e.minion === "M",
    );
    expect(dmg).toMatchObject({ amount: 3 });
  });
});
