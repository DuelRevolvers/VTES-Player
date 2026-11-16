import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/engine.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function stateWithCards() {
  const state = threeSeatGame();
  Object.assign(state.seats[0]!.minions[0]!, { blood: 5, disciplines: { obf: "basic", tem: "superior" } });
  state.seats[0]!.hand.push({ id: "de1", name: "Domain of Evernight" }, { id: "de2", name: "Domain of Evernight" });
  return state;
}
function announce(engine: VtesEngine, action = "bleed:V1") {
  runTrace(engine, [["Alice", action], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
}
function resolveCard(engine: VtesEngine, id: string) {
  engine.choose(id);
  runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
}
function passTo(engine: VtesEngine, window: string) {
  for (let i = 0; i < 40; i++) {
    const dp = engine.decision()!;
    if (dp.window === window) return dp;
    const pick = dp.options.find(o => o.id === "pass") ?? dp.options[0]!;
    engine.choose(pick.id);
  }
  throw new Error(`did not reach ${window}`);
}

describe("Domain of Evernight", () => {
  it("offers separate basic obfuscate and temporis modes at their proper timing", () => {
    const state = stateWithCards();
    const engine = new VtesEngine(state, testRegistry);
    announce(engine);
    const ids = engine.decision()!.options.map(o => o.id);
    expect(ids).toContain("play:Domain of Evernight:basic:V1:tem:de1");
    expect(ids.some(i => i.includes("Domain of Evernight:superior"))).toBe(false);
    runTrace(engine, [["Alice", "pass"], ["Bob", "block:M"]]);
    expect(engine.decision()!.options.map(o => o.id)).toContain("play:Domain of Evernight:basic:V1:obf:de1");
    resolveCard(engine, "play:Domain of Evernight:basic:V1:obf:de1");
    expect(state.eventLog.some(e => e.type === "StealthModified" && e.source === "Domain of Evernight" && e.delta === 1)).toBe(true);
  });
  it("basic temporis sets the combat damage rider, not stealth", () => {
    const state = stateWithCards();
    const engine = new VtesEngine(state, testRegistry);
    announce(engine);
    resolveCard(engine, "play:Domain of Evernight:basic:V1:tem:de1");
    const af = state.frames.find(f => f.kind === "action");
    expect(af?.kind === "action" && af.actorCombatRider.combatAggravated).toBe(true);
    expect(state.eventLog.some(e => e.type === "StealthModified" && e.source === "Domain of Evernight")).toBe(false);
  });
  it("basic temporis aggravates damage to both vampires in the blocking combat", () => {
    const state = stateWithCards();
    Object.assign(state.seats[1]!.minions.find(m => m.id === "M")!, { blood: 5, capacity: 5 });
    const engine = new VtesEngine(state, testRegistry);
    announce(engine);
    resolveCard(engine, "play:Domain of Evernight:basic:V1:tem:de1");
    runTrace(engine, [["Alice", "pass"], ["Bob", "block:M"]]);
    for (let i = 0; i < 100; i++) {
      const dp = engine.decision()!;
      if (dp.window === "turn.minion") break;
      const pick = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand") ?? dp.options[0]!;
      engine.choose(pick.id);
    }
    const damage = state.eventLog.filter(e => e.type === "DamageInflicted");
    expect(damage.some(e => e.type === "DamageInflicted" && e.minion === "V1" && e.aggravated)).toBe(true);
    expect(damage.some(e => e.type === "DamageInflicted" && e.minion === "M" && e.aggravated)).toBe(true);
  });
  it("superior unlocks after success and is limited per vampire per turn", () => {
    const state = stateWithCards();
    const engine = new VtesEngine(state, testRegistry);
    announce(engine);
    const dp = passTo(engine, "action.afterResolution");
    expect(dp.options.map(o => o.id)).toContain("play:Domain of Evernight:superior:V1:de1");
    resolveCard(engine, "play:Domain of Evernight:superior:V1:de1");
    expect(state.seats[0]!.minions[0]!.locked).toBe(false);
    passTo(engine, "turn.minion");
    announce(engine, "hunt:V1");
    for (let i = 0; i < 18; i++) {
      const next = engine.decision()!;
      expect(next.options.some(o => o.id.includes("Domain of Evernight:superior:V1"))).toBe(false);
      if (next.window === "turn.minion") break;
      engine.choose((next.options.find(o => o.id === "pass") ?? next.options[0]!).id);
    }
  });
  it("the limit does not prevent another vampire from using superior", () => {
    const state = stateWithCards();
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { blood: 3, disciplines: { tem: "superior" } }));
    const engine = new VtesEngine(state, testRegistry);
    announce(engine);
    passTo(engine, "action.afterResolution");
    resolveCard(engine, "play:Domain of Evernight:superior:V1:de1");
    passTo(engine, "turn.minion");
    announce(engine, "bleed:V2");
    const dp = passTo(engine, "action.afterResolution");
    expect(dp.options.map(o => o.id)).toContain("play:Domain of Evernight:superior:V2:de2");
  });
  it("cannot be used at superior after a blocked action", () => {
    const state = stateWithCards();
    const engine = new VtesEngine(state, testRegistry);
    announce(engine);
    runTrace(engine, [["Alice", "pass"], ["Bob", "block:M"]]);
    for (let i = 0; i < 80; i++) {
      const dp = engine.decision()!;
      expect(dp.options.some(o => o.id.includes("Domain of Evernight:superior"))).toBe(false);
      if (dp.window === "turn.minion") return;
      engine.choose((dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand") ?? dp.options[0]!).id);
    }
    throw new Error("blocked action did not end");
  });
  it("allows superior again on that vampire's next turn", () => {
    const state = stateWithCards();
    const engine = new VtesEngine(state, testRegistry);
    announce(engine);
    passTo(engine, "action.afterResolution");
    resolveCard(engine, "play:Domain of Evernight:superior:V1:de1");
    for (let i = 0; i < 300; i++) {
      const dp = engine.decision()!;
      const tf = state.frames.find(f => f.kind === "turn");
      if (tf?.kind === "turn" && tf.turnNumber > 1 && tf.seat === "Alice" && dp.window === "turn.minion") break;
      engine.choose((dp.options.find(o => o.id === "pass") ?? dp.options[0]!).id);
    }
    const turn = state.frames.find(f => f.kind === "turn");
    expect(turn?.kind === "turn" && turn.turnNumber > 1 && turn.seat === "Alice").toBe(true);
    announce(engine);
    expect(passTo(engine, "action.afterResolution").options.map(o => o.id)).toContain("play:Domain of Evernight:superior:V1:de2");
  });

});
