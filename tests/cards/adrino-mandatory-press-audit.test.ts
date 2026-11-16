import { describe, expect, it } from "vitest";
import { VtesEngine, type CombatFrame, type GameState } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function fight(frenzy = false) {
  const state = threeSeatGame();
  const actor = state.seats[0]!.minions[0]!;
  const opponent = state.seats[1]!.minions.find(m => m.id === "M")!;
  Object.assign(actor, { name: "Adrino Manauara (G6)", blood: 10, capacity: 10, strength: 0, disciplines: { pre: "basic" } });
  Object.assign(opponent, { blood: 10, capacity: 10, strength: 0, disciplines: { ani: "basic" } });
  const entry = testRegistry[actor.name]!.cryptEntry!();
  actor.attached.push({ card: { id: "adrino", name: actor.name }, locked: false, usedThisPhase: false, statics: entry.statics, tags: entry.tags });
  if (frenzy) state.seats[1]!.hand.push({ id: "frenzy", name: "Terror Frenzy" });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
  if (frenzy) runTrace(engine, [["Alice", "pass"], ["Bob", "play:Terror Frenzy:basic:M:frenzy"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
  const cf = state.frames.find((f): f is CombatFrame => f.kind === "combat");
  if (!cf) throw new Error("no combat");
  return { state, engine, cf };
}
function advance(engine: VtesEngine, condition: () => boolean, limit = 200) {
  for (let i = 0; i < limit && !condition(); i++) {
    const dp = engine.decision();
    if (!dp) throw new Error("no decision");
    const choice = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand") ?? dp.options[0];
    if (!choice) throw new Error(`no choice in ${dp.window}`);
    engine.choose(choice.id);
  }
  if (!condition()) throw new Error("decision not reached");
}

describe("Adrino mandatory press interactions", () => {
  it("cannot use the mandatory press while Terror Frenzy prohibits pressing to continue", () => {
    const { state, engine, cf } = fight(true);
    advance(engine, () => engine.decision()?.window === "combat.press" && engine.decision()?.seat === "Alice");
    expect(cf.mandatoryContinuePresses?.acting).toBe(1);
    expect(engine.decision()!.options.some(o => o.id === "press:continue")).toBe(false);
    expect(engine.decision()!.options.some(o => o.id === "pass")).toBe(true);
    advance(engine, () => state.eventLog.some(e => e.type === "CombatEnded"));
    expect(state.eventLog.some(e => e.type === "PressUsed" && e.seat === "Alice")).toBe(false);
  });
  it("spends the press even if the opponent cancels it, including after save/load", () => {
    const { state, engine, cf } = fight();
    cf.pressesCombat.opposing = 1;
    advance(engine, () => engine.decision()?.options.some(o => o.id === "press:continue") === true);
    expect(engine.decision()!.seat).toBe("Alice");
    engine.choose("press:continue");
    expect(engine.decision()!.options.some(o => o.id === "press:end")).toBe(true);
    engine.choose("press:end");
    expect(engine.decision()!.options.some(o => o.id === "press:continue")).toBe(false);
    // Once used, Adrino's press is spent even when the other minion cancels it.
    const saved = JSON.parse(JSON.stringify(state)) as GameState;
    const resumed = new VtesEngine(saved, testRegistry);
    advance(resumed, () => saved.eventLog.some(e => e.type === "CombatEnded"));
    expect(saved.eventLog.filter(e => e.type === "PressUsed" && e.seat === "Alice")).toHaveLength(1);
  });
  it("keeps a second mandatory press for a later round if combat is already continuing (synthetic source)", () => {
    const { state, engine, cf } = fight();
    const opponent = state.seats[1]!.minions.find(m => m.id === "M")!;
    // A second source exercises the same mandatory rule on both sides.
    cf.mandatoryContinuePresses!.opposing = 1;
    advance(engine, () => engine.decision()?.options.some(o => o.id === "press:continue") === true);
    engine.choose("press:continue");
    expect(engine.decision()!.seat).toBe("Bob");
    expect(engine.decision()!.options.some(o => o.id === "press:continue")).toBe(false);
    expect(cf.mandatoryContinuePresses!.opposing).toBe(1);
    engine.choose("pass");
    advance(engine, () => cf.round === 2 && engine.decision()?.window === "combat.press" && engine.decision()?.seat === "Bob");
    expect(opponent.inTorpor).toBe(false);
    expect(engine.decision()!.options.map(o => o.id)).toEqual(["press:continue"]);
    engine.choose("press:continue");
    expect(cf.mandatoryContinuePresses!.opposing).toBe(0);
    expect(state.eventLog.filter(e => e.type === "PressUsed").map(e => e.seat)).toEqual(["Alice", "Bob"]);
  });
  it("does not force a press when Majesty ends combat before the press step", () => {
    const { state, engine } = fight();
    state.seats[0]!.hand.push({ id: "majesty", name: "Majesty" });
    advance(engine, () => engine.decision()?.options.some(o => o.id.startsWith("play:Majesty:basic:V1")) === true);
    engine.choose(engine.decision()!.options.find(o => o.id.startsWith("play:Majesty:basic:V1"))!.id);
    advance(engine, () => state.eventLog.some(e => e.type === "CombatEnded"));
    expect(state.eventLog.some(e => e.type === "PressUsed")).toBe(false);
  });

  it("spends the mandatory press before an optional press and resets it in the next combat", () => {
    const { engine, cf } = fight();
    cf.pressesCombat.acting = 1;
    advance(engine, () => engine.decision()?.options.some(o => o.id === "press:continue") === true);
    expect(engine.decision()!.options.map(o => o.id)).toEqual(["press:continue"]);
    engine.choose("press:continue");
    expect(cf.mandatoryContinuePresses!.acting).toBe(0);
    expect(cf.pressesCombat.acting).toBe(1);
    const next = fight();
    expect(next.cf.mandatoryContinuePresses!.acting).toBe(1);
  });

});
