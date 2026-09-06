/**
 * Unlock-and-block Wave 2 (docs/unlock-and-block-design.md): One With the
 * Land (force block + neither combatant strikes the first round) and My
 * Enemy's Enemy (redirect the bleed to your predator's predator).
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("One With the Land (102256)", () => {
  it("superior: forces a block and suppresses strikes in the first round", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.disciplines = { dom: "basic" };
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.disciplines = { pro: "superior" };
    m.locked = true;
    state.seats[1]!.hand.push({ id: "owl1", name: "One With the Land" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], // state A
      ["Bob", "play:One With the Land:superior:M"], // unlock + forced block
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt → combat
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range → close
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes → suppressed
      // No chooseStrike this round; straight to press.
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    expect(state.eventLog.some((e) => e.type === "CombatBegan")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "StrikeChosen")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "DamageInflicted")).toBe(false);
  });
});

describe("My Enemy's Enemy (101259)", () => {
  it("superior: redirects the bleed to the predator's predator", () => {
    const state = threeSeatGame();
    // Alice → Bob → Carol. Alice (Bob's predator) bleeds Bob; My Enemy's
    // Enemy sends it to Bob's predator's predator = Carol.
    state.seats[0]!.minions[0]!.disciplines = { dom: "basic" };
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.disciplines = { aus: "superior" };
    state.seats[1]!.hand.push({ id: "mee1", name: "My Enemy's Enemy" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A: Bob declines
      ["Alice", "pass"],
      ["Bob", "play:My Enemy's Enemy:superior:M"], // redirect to Carol
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
    ]);

    const ev = state.eventLog.find((e) => e.type === "TargetChanged");
    expect(ev && ev.type === "TargetChanged" ? ev.to : null).toBe("Carol");
    expect(state.seats[1]!.minions.find((x) => x.id === "M")!.locked).toBe(true);
  });
});
