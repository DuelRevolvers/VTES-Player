import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function board() {
  const state = threeSeatGame();
  Object.assign(state.seats[0]!.minions[0]!, { blood: 4, disciplines: { obe: "basic", dom: "basic" } });
  state.seats[0]!.hand.push({ id: "sm", name: "Spirit Marionette" });
  return { state, engine: new VtesEngine(state, testRegistry) };
}
function toChoice(engine: VtesEngine) {
  for (let i = 0; i < 30; i++) {
    const dp = engine.decision()!;
    if (dp.window === "choice" || dp.window === "turn.minion") return dp;
    engine.choose("pass");
  }
  throw new Error("action did not finish");
}

describe("Spirit Marionette inferior Obeah", () => {
  it("requires a ready minion of the prey, but not an unlocked one", () => {
    const { state, engine } = board();
    for (const m of state.seats[1]!.minions) m.inTorpor = true;
    expect(engine.decision()!.options.some(o => o.id.includes("Spirit Marionette:basic:V1:obe"))).toBe(false);
    state.seats[1]!.minions[0]!.inTorpor = false;
    state.seats[1]!.minions[0]!.locked = true;
    expect(engine.decision()!.options.some(o => o.id.includes("Spirit Marionette:basic:V1:obe"))).toBe(true);
  });
  it("lets the actor select the prey's minion after the bleed lands", () => {
    const { state, engine } = board();
    runTrace(engine, [["Alice", "play:Spirit Marionette:basic:V1:obe:sm"]]);
    const dp = toChoice(engine);
    expect(dp.window).toBe("choice");
    expect(dp.seat).toBe("Alice");
    expect(state.seats[1]!.pool).toBe(8);
    expect(dp.options.some(o => o.id.endsWith(":M"))).toBe(true);
    engine.choose("choice:Spirit Marionette:sm:lockPreyMinion:M");
    expect(state.seats[1]!.minions.find(m => m.id === "M")!.locked).toBe(true);
    expect(state.seats[1]!.minions.find(m => m.id === "W")!.locked).toBe(false);
  });
  it("retains the prey's minions after Deflection changes the bleed target", () => {
    const { state, engine } = board();
    Object.assign(state.seats[1]!.minions.find(m => m.id === "W")!, { disciplines: { dom: "superior" }, blood: 4 });
    state.seats[1]!.hand.push({ id: "d", name: "Deflection" });
    runTrace(engine, [["Alice", "play:Spirit Marionette:basic:V1:obe:sm"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "play:Deflection:superior:W:Carol:d"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    const dp = toChoice(engine);
    expect(dp.window).toBe("choice");
    expect(dp.seat).toBe("Alice");
    expect(dp.options.some(o => o.id.endsWith(":M"))).toBe(true);
    expect(dp.options.some(o => o.id.endsWith(":N"))).toBe(false);
    expect(state.seats[1]!.pool).toBe(10);
    expect(state.seats[2]!.pool).toBe(8);
  });
  it("keeps Dominate's plain bleed distinct from Obeah", () => {
    const { state, engine } = board();
    runTrace(engine, [["Alice", "play:Spirit Marionette:basic:V1:dom:sm"]]);
    expect(toChoice(engine).window).toBe("turn.minion");
    expect(state.seats[1]!.minions.every(m => !m.locked)).toBe(true);
  });
});
