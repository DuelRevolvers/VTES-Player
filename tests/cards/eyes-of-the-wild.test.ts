/**
 * Eyes of the Wild (102222) — a locked Gangrel unlocks and attempts to
 * block, and during the action can burn 1 blood for +1 intercept
 * (repeatable, action-scoped) to make its forced block succeed.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("Eyes of the Wild (102222)", () => {
  it("burns blood for +1 intercept to win a forced block against stealth", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { dom: "basic", obf: "basic" };
    state.seats[0]!.hand.push({ id: "lic1", name: "Lost in Crowds" });
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.clan = "Gangrel";
    m.blood = 3;
    m.locked = true;
    state.seats[1]!.hand.push({ id: "ew1", name: "Eyes of the Wild" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], // state A
      ["Bob", "play:Eyes of the Wild:basic:M"], // unlock + forced block
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // reaction as-played
      // Block attempt: Alice raises stealth to 1.
      ["Alice", "play:Lost in Crowds:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // LiC as-played
      ["Alice", "pass"], // acting side, block attempt impulse
      ["Bob", "burn:intercept:M"], // burn 1 blood → intercept 1 ≥ stealth 1
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // attempt → success → combat
    ]);

    expect(state.eventLog.some((e) => e.type === "CombatBegan")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "BlockSucceeded" && e.blocker === "M")).toBe(true);
    expect(state.seats[1]!.minions.find((x) => x.id === "M")!.blood).toBe(2); // burned 1
  });
});
