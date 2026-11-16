import { describe, expect, it } from "vitest";
import { VtesEngine, type GameState } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const ability = "ability:Cedric (G4):cedric:unlock";
function setup(action: "bleed" | "hunt" = "bleed") {
  const state = threeSeatGame();
  const cedric = state.seats[1]!.minions.find(m => m.id === "W")!;
  Object.assign(cedric, { name: "Cedric (G4)", blood: 4 });
  const self = testRegistry["Cedric (G4)"]!.cryptEntry!();
  cedric.attached.push({ card: { id: "cedric", name: "Cedric (G4)" }, locked: false,
    usedThisPhase: false, statics: self.statics, tags: self.tags });
  state.seats[0]!.minions[0]!.blood = 4;
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [["Alice", `${action}:V1`], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:W"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
  return { state, cedric, engine };
}
function finishCombat(e: VtesEngine) {
  for (let i = 0; i < 80; i++) {
    const dp = e.decision()!;
    if (dp.window === "action.afterResolution" || dp.window === "turn.minion") return dp;
    const pick = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand");
    if (!pick) throw new Error(`no pass in ${dp.window}: ${dp.options.map(o => o.id)}`);
    e.choose(pick.id);
  }
  throw new Error("combat did not finish");
}
function bobImpulse(e: VtesEngine) {
  for (let i = 0; i < 10 && e.decision()?.seat !== "Bob"; i++) e.choose("pass");
  return e.decision()!;
}

describe("Cedric (G4)", () => {
  it("can spend blood to unlock after a directed action he blocked and its combat", () => {
    const { state, cedric, engine } = setup();
    expect(engine.decision()!.options.some(o => o.id === ability)).toBe(false);
    expect(finishCombat(engine).window).toBe("action.afterResolution");
    expect(cedric.locked).toBe(true);
    expect(bobImpulse(engine).options.some(o => o.id === ability)).toBe(true);
    const saved = JSON.parse(JSON.stringify(state)) as GameState;
    const resumed = new VtesEngine(saved, testRegistry);
    const before = saved.seats[1]!.minions.find(m => m.id === "W")!.blood;
    resumed.choose(ability);
    const m = saved.seats[1]!.minions.find(m => m.id === "W")!;
    expect(m.blood).toBe(before - 1);
    expect(m.locked).toBe(false);
    expect(resumed.decision()!.options.some(o => o.id === ability)).toBe(false);
  });
  it("does not trigger on an undirected action", () => {
    const { engine } = setup("hunt");
    expect(finishCombat(engine).window).toBe("turn.minion");
  });
  it("does not offer an unlock he cannot pay for", () => {
    const { engine, cedric } = setup();
    cedric.blood = 0;
    finishCombat(engine);
    expect(engine.decision()!.options.some(o => o.id === ability)).toBe(false);
  });
  it("allows declining without paying or unlocking", () => {
    const { engine, cedric } = setup();
    finishCombat(engine);
    const dp = bobImpulse(engine);
    expect(dp.options.some(o => o.id === ability)).toBe(true);
    const blood = cedric.blood;
    for (let i = 0; i < 5 && engine.decision()?.window === "action.afterResolution"; i++) engine.choose("pass");
    expect(cedric.locked).toBe(true);
    expect(cedric.blood).toBe(blood);
  });
});
