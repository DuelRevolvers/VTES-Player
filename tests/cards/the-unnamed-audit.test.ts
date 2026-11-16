import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function setup() {
  const state = threeSeatGame();
  const m = state.seats[0]!.minions[0]!;
  const self = testRegistry["The unnamed (G6)"]!.cryptEntry!();
  m.attached.push({ card: { id: "u", name: "The unnamed (G6)" }, locked: false, usedThisPhase: false, statics: self.statics, tags: self.tags });
  return { state, m, engine: new VtesEngine(state, testRegistry) };
}
const gain = "choice:The unnamed (G6):u:bleedPool:yes";
function walk(engine: VtesEngine, stop: () => boolean, max = 60) {
  for (let i = 0; i < max && !stop(); i++) {
    const dp = engine.decision()!;
    const option = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand");
    if (!option) throw new Error(`unexpected ${dp.window}: ${dp.options.map(o => o.id)}`);
    engine.choose(option.id);
  }
  expect(stop()).toBe(true);
}

describe("The unnamed (G6) bleed payoff", () => {
  it("offers the controller 2 pool after its own successful bleed and survives save/restore", () => {
    const { state, engine } = setup();
    engine.choose("bleed:V1");
    walk(engine, () => engine.decision()?.options.some(o => o.id === gain) === true);
    expect(state.seats[0]!.pool).toBe(10);
    const saved = JSON.parse(JSON.stringify(state)) as GameState;
    const restored = new VtesEngine(saved, testRegistry);
    restored.choose(gain);
    expect(saved.seats[0]!.pool).toBe(12);
    expect(saved.seats[1]!.pool).toBe(9);
  });
  it("takes the Edge before the pool gain when The Rising is in play", () => {
    const { state, engine } = setup();
    state.seats[1]!.permanents.push({card:{id:'rising',name:'The Rising'},locked:false,usedThisPhase:false,statics:{barsPoolGainOnOwnTurn:true},tags:['event']});
    engine.emit({type:'PoolGained',seat:'Alice',amount:1});
    expect(state.seats[0]!.pool).toBe(10);
    engine.choose("bleed:V1");
    walk(engine, () => engine.decision()?.options.some(o => o.id === gain) === true);
    expect(state.edge).toBe("Alice");
    engine.choose(gain);
    expect(state.seats[0]!.pool).toBe(12);
  });
  it("is optional", () => {
    const { state, engine } = setup();
    engine.choose("bleed:V1");
    walk(engine, () => engine.decision()?.options.some(o => o.id === gain) === true);
    engine.choose("pass");
    expect(state.seats[0]!.pool).toBe(10);
  });
  it("does not trigger for another vampire's successful bleed", () => {
    const { state, engine } = setup();
    state.seats[0]!.minions.push(makeMinion("other", "Alice"));
    engine.choose("bleed:other");
    walk(engine, () => state.eventLog.some(e => e.type === "ActionResolved"));
    expect(state.frames.some(f => f.kind === "choice" && f.cardName === "The unnamed (G6)")).toBe(false);
    expect(state.seats[1]!.pool).toBe(9);
  });
  it("does not trigger if the bleed is reduced to zero", () => {
    const { state, engine } = setup();
    engine.choose("bleed:V1");
    const af = state.frames.find(f => f.kind === "action")!;
    if (af.kind !== "action") throw new Error("no action");
    engine.emit({ type: "BleedAmountModified", actionId: af.actionId, delta: -1, source: "test", limited: false });
    walk(engine, () => state.eventLog.some(e => e.type === "ActionResolved"));
    expect(state.frames.some(f => f.kind === "choice" && f.cardName === "The unnamed (G6)")).toBe(false);
    expect(state.seats[1]!.pool).toBe(10);
  });
  it("does not trigger on a blocked bleed", () => {
    const { state, engine } = setup();
    runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:W"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    walk(engine, () => state.eventLog.some(e => e.type === "ActionResolved"));
    expect(state.frames.some(f => f.kind === "choice" && f.cardName === "The unnamed (G6)")).toBe(false);
    expect(state.seats[0]!.pool).toBe(10);
  });
});

describe("The unnamed's strike", () => {
  function intoCombat(blood = 5) {
    const { state, m, engine } = setup();
    m.blood = blood; m.capacity = 8;
    const foe = state.seats[1]!.minions.find(x => x.id === "M")!;
    foe.blood = 5; foe.capacity = 8;
    runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    walk(engine, () => engine.decision()?.window === "combat.range" && engine.decision()?.seat === "Alice");
    return { state, m, foe, engine };
  }
  const strike = "ability:The unnamed (G6):u:strike";
  it("burns one blood to choose a ranged aggravated strike, including after save/restore", () => {
    const { state, engine } = intoCombat();
    const cf = state.frames.find(f => f.kind === "combat")!;
    if (cf.kind !== "combat") throw Error("combat");
    cf.maneuverCredits.acting = 1;
    engine.choose("maneuver:credit");
    walk(engine, () => engine.decision()?.window === "combat.chooseStrike" && engine.decision()?.seat === "Alice");
    expect(cf.range).toBe("long");
    const saved = JSON.parse(JSON.stringify(state)) as GameState;
    const resumed = new VtesEngine(saved, testRegistry);
    expect(resumed.decision()!.options.some(o => o.id === strike)).toBe(true);
    resumed.choose(strike);
    const rcf = saved.frames.find(f => f.kind === "combat")!;
    if (rcf.kind !== "combat") throw Error("combat");
    expect(rcf.strikes.acting).toMatchObject({ source: "ability", damage: 2, ranged: true, aggravated: true });
    expect(saved.seats[0]!.minions[0]!.blood).toBe(4);
    resumed.choose("strike:hand");
    walk(resumed, () => saved.seats[1]!.minions.find(m => m.id === "M")!.inTorpor);
    expect(saved.seats[1]!.minions.find(m => m.id === "M")!.blood).toBe(4);
    expect(saved.eventLog.some(e => e.type === "CardPlayed" && e.name === "The unnamed (G6)")).toBe(false);
  });
  it("does not offer it with no blood, a forced strike, hand-strikes-only or a committed weapon", () => {
    const { state, engine, m } = intoCombat();
    walk(engine, () => engine.decision()?.window === "combat.chooseStrike" && engine.decision()?.seat === "Alice");
    const cf=state.frames.find(f => f.kind === "combat")!;
    if (cf.kind !== "combat") throw Error("combat");
    const offered = () => engine.decision()!.options.some(o => o.id === strike);
    expect(offered()).toBe(true);
    m.blood=0; expect(offered()).toBe(false); m.blood=5;
    cf.handStrikesOnly=true; expect(offered()).toBe(false); cf.handStrikesOnly=false;
    cf.forcedHandStrike={acting:1,opposing:null}; expect(offered()).toBe(false); cf.forcedHandStrike.acting=null;
    m.attached.push({ card:{id:'gun',name:'.44 Magnum'},locked:false,usedThisPhase:false,statics:{},tags:['equipment','weapon'] });
    cf.committedStrike.acting='gun'; expect(offered()).toBe(false);
  });
});
