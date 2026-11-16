import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function setup() {
  const state = threeSeatGame();
  const actor = state.seats[0]!.minions[0]!;
  const h = testRegistry["Hrothulf (G3)"]!.cryptEntry!();
  actor.attached.push({ card: { id: "h", name: "Hrothulf (G3)" }, locked: false, usedThisPhase: false, statics: h.statics, tags: h.tags });
  actor.blood = 5;
  state.seats[0]!.minions.push(makeMinion("ally-v", "Alice"));
  state.seats[1]!.minions.push(makeAlly("ally-b", "Bob", 4));
  state.edge = "Alice";
  return { state, actor, engine: new VtesEngine(state, testRegistry) };
}
const actionId = "act:Hrothulf (G3):h:M";
function resolveToCombatOrActionEnd(engine: VtesEngine, state: GameState) {
  for (let i = 0; i < 40; i++) {
    if (state.frames.some(f => f.kind === "combat") || !state.frames.some(f => f.kind === "action")) return;
    const dp = engine.decision()!;
    const pass = dp.options.find(o => o.id === "pass");
    if (!pass) throw new Error(`no pass in ${dp.window}`);
    engine.choose(pass.id);
  }
  throw new Error("action did not resolve");
}
function ids(engine: VtesEngine) { return engine.decision()!.options.map(o => o.id); }

describe("Hrothulf (G3)", () => {
  it("requires the Edge and targets another Methuselah's ready vampire or ally", () => {
    const { state, engine } = setup();
    const options = ids(engine);
    expect(options).toContain(actionId);
    expect(options).toContain("act:Hrothulf (G3):h:ally-b");
    expect(options).not.toContain("act:Hrothulf (G3):h:ally-v");
    const target = state.seats[1]!.minions.find(m => m.id === "M")!;
    target.inTorpor = true;
    expect(ids(engine)).not.toContain(actionId);
    state.edge = "Bob";
    expect(ids(engine).some(id => id.startsWith("act:Hrothulf"))).toBe(false);
  });
  it("burns Edge on successful resolution and enters combat with the chosen minion", () => {
    const { state, engine, actor } = setup();
    engine.choose(actionId);
    expect(state.edge).toBe("Alice");
    expect(actor.locked).toBe(true);
    const restored = JSON.parse(JSON.stringify(state)) as GameState;
    const resumed = new VtesEngine(restored, testRegistry);
    resolveToCombatOrActionEnd(resumed, restored);
    expect(restored.edge).toBeNull();
    expect(restored.eventLog.some(e => e.type === "EdgeBurned" && e.seat === "Alice")).toBe(true);
    expect(restored.eventLog.some(e => e.type === "CombatBegan" && e.acting === "V1" && e.opposing === "M")).toBe(true);
  });
  it("does not burn the Edge when blocked", () => {
    const { state, engine } = setup();
    runTrace(engine, [["Alice", actionId], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(state.frames.some(f => f.kind === "combat")).toBe(true);
    for (let i = 0; i < 80 && state.frames.some(f => f.kind === "combat" || f.kind === "action"); i++) {
      const dp = engine.decision()!;
      const pick = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand") ?? dp.options[0]!;
      engine.choose(pick.id);
    }
    expect(state.edge).toBe("Alice");
    expect(state.eventLog.some(e => e.type === "EdgeBurned")).toBe(false);
  });
  it("cannot pay the effect if the Edge changes hands before resolution", () => {
    const { state, engine } = setup();
    engine.choose(actionId);
    engine.takeEdge("Carol");
    resolveToCombatOrActionEnd(engine, state);
    expect(state.edge).toBe("Carol");
    expect(state.eventLog.some(e => e.type === "CombatBegan")).toBe(false);
    expect(state.eventLog.some(e => e.type === "EdgeBurned")).toBe(false);
  });
  it("pays the Edge when Go-getter continues a blocked action as unblocked", () => {
    const { state, engine, actor } = setup();
    actor.clan = "Ravnos";
    actor.disciplines = { obf: "superior" };
    state.seats[0]!.hand.push({ id: "gg", name: "Go-getter" });
    runTrace(engine, [["Alice", actionId], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    let played = false;
    for (let i = 0; i < 100; i++) {
      const dp = engine.decision()!;
      const gg = dp.options.find(o => o.id.startsWith("play:Go-getter:superior"));
      if (gg) { expect(state.edge).toBe("Alice"); engine.choose(gg.id); played = true; break; }
      const pick = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand") ?? dp.options[0]!;
      engine.choose(pick.id);
    }
    expect(played).toBe(true);
    for (let i = 0; i < 30 && state.frames.some(f => f.kind === "action"); i++) engine.choose("pass");
    expect(state.eventLog.filter(e => e.type === "EdgeBurned" && e.seat === "Alice")).toHaveLength(1);
    expect(state.eventLog.some(e => e.type === "ActionContinued")).toBe(true);
    expect(state.eventLog.filter(e => e.type === "CombatBegan")).toHaveLength(2);
  });
  it("does not offer the same action again that turn after it resolves", () => {
    const { state, engine, actor } = setup();
    engine.choose(actionId);
    resolveToCombatOrActionEnd(engine, state);
    for (let i = 0; i < 80 && state.frames.some(f => f.kind === "combat"); i++) {
      const dp = engine.decision()!;
      const pick = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand") ?? dp.options[0]!;
      engine.choose(pick.id);
    }
    state.edge = "Alice";
    actor.locked = false;
    expect(ids(engine).some(id => id.startsWith("act:Hrothulf"))).toBe(false);
  });
});
