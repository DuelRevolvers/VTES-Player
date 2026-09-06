/**
 * Organized Resistance (102230) — a locked baron's reaction whose effect
 * targets a *different* Anarch you control: give the blocking Anarch +1
 * intercept, or unlock a locked Anarch to force-block with +1 intercept.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Bob's W is the locked baron who plays it; M is another Anarch. */
function bobWithBaron(): ReturnType<typeof threeSeatGame> {
  const state = threeSeatGame();
  state.seats[0]!.minions[0]!.disciplines = { dom: "basic", obf: "basic" };
  const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
  w.title = "baron";
  w.sect = "anarch";
  w.locked = true;
  const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
  m.sect = "anarch";
  state.seats[1]!.hand.push({ id: "or1", name: "Organized Resistance" });
  return state;
}

describe("Organized Resistance (102230)", () => {
  it("use 2: unlocks a locked Anarch you control so it force-blocks", () => {
    const state = bobWithBaron();
    state.seats[1]!.minions.find((x) => x.id === "M")!.locked = true;
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], // state A
      ["Bob", "play:Organized Resistance:basic:W:unlock:M"], // unlock M + force block
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt → combat
    ]);

    expect(state.eventLog.some((e) => e.type === "MinionUnlocked" && e.minion === "M")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "BlockDeclared" && e.blocker === "M")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "CombatBegan")).toBe(true);
  });

  it("use 1: gives the currently-blocking Anarch +1 intercept", () => {
    const state = bobWithBaron();
    state.seats[0]!.hand.push({ id: "lic1", name: "Lost in Crowds" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"], // M (Anarch) blocks
      ["Alice", "play:Lost in Crowds:basic"], // stealth 1 → intercept needed
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // LiC as-played
      ["Alice", "pass"],
      ["Bob", "play:Organized Resistance:basic:W:intercept:M"], // +1 intercept to M
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
    ]);

    expect(
      state.eventLog.some(
        (e) => e.type === "InterceptModified" && e.minion === "M" && e.delta === 1 && e.source === "Organized Resistance",
      ),
    ).toBe(true);
  });
});
