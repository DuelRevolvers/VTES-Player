import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function setup() {
  const state = threeSeatGame();
  const alex = state.seats[0]!.minions[0]!;
  const self = testRegistry["Alex Wilkins (G5)"]!.cryptEntry!();
  Object.assign(alex, { name: "Alex Wilkins (G5)", blood: 1, capacity: 1 });
  alex.attached.push({ card: { id: "alex", name: "Alex Wilkins (G5)" }, locked: false,
    usedThisPhase: false, statics: self.statics, tags: self.tags });
  return { state, alex, engine: new VtesEngine(state, testRegistry) };
}
function finish(engine: VtesEngine) {
  for (let i = 0; i < 60; i++) {
    const dp = engine.decision()!;
    if (dp.window === "choice" || dp.window === "turn.minion") return dp;
    const opt = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand");
    if (!opt) throw new Error(`unexpected ${dp.window}`);
    engine.choose(opt.id);
  }
  throw new Error("no finish");
}

describe("Alex Wilkins", () => {
  it("offers the bleed target a choice after resolution and retains it across save/load", () => {
    const { state, engine } = setup();
    engine.choose("bleed:V1");
    const dp = finish(engine);
    expect(dp.seat).toBe("Bob");
    expect(dp.options.map(o => o.id)).toContain("choice:Alex Wilkins (G5):alex:stealAlex:yes");
    expect(state.seats[1]!.pool).toBe(9);
    expect(state.eventLog.some(e => e.type === "ActionResolved" && e.success)).toBe(true);
    const restored = JSON.parse(JSON.stringify(state)) as GameState;
    new VtesEngine(restored, testRegistry).choose("choice:Alex Wilkins (G5):alex:stealAlex:yes");
    expect(restored.seats[1]!.pool).toBe(8);
    expect(restored.seats[1]!.minions.find(m => m.id === "V1")?.controller).toBe("Bob");
  });
  it("permits the target to decline", () => {
    const { state, engine } = setup();
    engine.choose("bleed:V1");
    expect(finish(engine).seat).toBe("Bob");
    engine.choose("pass");
    expect(state.seats[1]!.pool).toBe(9);
    expect(state.seats[0]!.minions.some(m => m.id === "V1")).toBe(true);
  });
  it("does not trigger on another vampire's bleed or a zero bleed", () => {
    const a = setup();
    a.state.seats[0]!.minions.push(makeMinion("other", "Alice"));
    a.engine.choose("bleed:other");
    expect(finish(a.engine).window).toBe("turn.minion");
    const b = setup();
    b.engine.choose("bleed:V1");
    const af = b.state.frames.find(f => f.kind === "action")!;
    if (af.kind !== "action") throw new Error("no action");
    b.engine.emit({ type: "BleedAmountModified", actionId: af.actionId, delta: -1, source: "test", limited: false });
    expect(finish(b.engine).window).toBe("turn.minion");
  });
  it("offers the redirected bleed target, not the original prey", () => {
    const { state, engine } = setup();
    Object.assign(state.seats[1]!.minions.find(m => m.id === "W")!, { disciplines: { dom: "superior" }, blood: 4 });
    state.seats[1]!.hand.push({ id: "d", name: "Deflection" });
    runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "play:Deflection:superior:W:Carol:d"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(finish(engine).seat).toBe("Carol");
    engine.choose("choice:Alex Wilkins (G5):alex:stealAlex:yes");
    expect(state.seats[1]!.pool).toBe(10);
    expect(state.seats[2]!.pool).toBe(8);
    expect(state.seats[2]!.minions.some(m => m.id === "V1")).toBe(true);
  });
});
