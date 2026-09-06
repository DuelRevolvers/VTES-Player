/**
 * Aggravated hand strikes (docs/one-off-sweep.md): "damage from this
 * vampire's hand strikes is aggravated this round" (Claws of the Dead,
 * Wolf Claws). One shared `handStrikesAggravated` combat-frame flag.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("Claws of the Dead (100356)", () => {
  it("makes the acting vampire's hand strike aggravated, sending the blocker to torpor", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pro: "basic" };
    v1.strength = 1;
    v1.blood = 5;
    v1.capacity = 5;
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.blood = 3;
    state.seats[0]!.hand.push({ id: "cd1", name: "Claws of the Dead" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range → close
      ["Alice", "play:Claws of the Dead:basic:V1"], // hand strikes aggravated
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // its as-played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // finish before strikes
      ["Alice", "strike:hand"], // 1 aggravated
      ["Bob", "strike:hand"],
      ["Alice", "pass"], // V1 mends M's hand strike
      ["Bob", "pass"], // M takes 1 aggravated → torpor
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    const dmg = state.eventLog.find(
      (e) => e.type === "DamageInflicted" && e.minion === "M",
    );
    expect(dmg).toMatchObject({ amount: 1, aggravated: true });
    expect(m.inTorpor).toBe(true);
  });
});

describe("Wolf Claws (102190)", () => {
  it("also makes the acting vampire's hand strike aggravated", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pro: "basic" };
    v1.strength = 2;
    v1.blood = 5;
    v1.capacity = 5;
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.blood = 3;
    state.seats[0]!.hand.push({ id: "wc1", name: "Wolf Claws" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "play:Wolf Claws:basic:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const dmg = state.eventLog.find(
      (e) => e.type === "DamageInflicted" && e.minion === "M",
    );
    expect(dmg).toMatchObject({ amount: 2, aggravated: true });
    expect(m.inTorpor).toBe(true);
  });
});
