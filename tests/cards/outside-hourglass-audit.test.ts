import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/engine.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function game() {
  const state = threeSeatGame();
  for (const seat of [0, 1]) {
    const m = seat === 0 ? state.seats[0]!.minions[0]! : state.seats[1]!.minions.find(m => m.id === "M")!;
    m.disciplines = { tem: "superior" }; m.blood = 8; m.capacity = 10;
    state.seats[seat]!.hand.push(...[0,1,2].map(i => ({ id: `${seat}-${i}`, name: "Outside the Hourglass" })));
  }
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [["Alice","bleed:V1"],["Alice","pass"],["Bob","pass"],["Carol","pass"],["Alice","pass"],["Bob","block:M"],["Alice","pass"],["Bob","pass"],["Carol","pass"]]);
  return {state, engine};
}
function find(e: VtesEngine, prefix: string) { return e.decision()?.options.find(o => o.id.startsWith(prefix)); }
function walk(e: VtesEngine, pred: () => boolean, limit = 100) {
  for (let i=0; i<limit && !pred(); i++) {
    const dp=e.decision(); if (!dp) break;
    const pick=dp.options.find(o=>o.id==='pass') ?? dp.options.find(o=>o.id==='strike:hand');
    if (!pick) throw new Error(`${dp.window}: ${dp.options.map(o=>o.id)}`);
    e.choose(pick.id);
  }
  expect(pred()).toBe(true);
}
describe("Outside the Hourglass", () => {
  it("offers the basic Temporis maneuver separately from the dodge", () => {
    const {state, engine} = game();
    walk(engine, () => engine.decision()?.window === "combat.range" && engine.decision()?.seat === "Alice");
    const option=find(engine,"play:Outside the Hourglass:basic:V1:maneuver");
    expect(option).toBeDefined(); engine.choose(option!.id);
    walk(engine, () => engine.decision()?.window === "combat.chooseStrike" && engine.decision()?.seat === "Alice");
    const cf=state.frames.find(f=>f.kind==='combat'); if (!cf || cf.kind!=='combat') throw Error('no combat');
    expect(cf.range).toBe("long");
    expect(find(engine,"play:Outside the Hourglass:basic:V1:dodge")).toBeDefined();
  });
  it("inflicts damage once from the vampire before strikes and survives a save", () => {
    const {state, engine} = game();
    engine.choose(find(engine,"play:Outside the Hourglass:superior:V1")!.id);
    walk(engine, () => engine.decision()?.window === "combat.beforeRange" && engine.decision()?.seat === "Alice");
    const cf=state.frames.find(f=>f.kind==='combat'); if (!cf || cf.kind !== 'combat') throw Error('combat');
    expect(cf.pendingDamage).toEqual(expect.arrayContaining([expect.objectContaining({minion:'M',amount:2,source:'V1',aggravated:false})]));
    expect(cf.roundDamage).toHaveLength(0);
    const saved=JSON.parse(JSON.stringify(state));
    const resumed=new VtesEngine(saved,testRegistry);
    walk(resumed, () => resumed.decision()?.window === 'combat.chooseStrike' && resumed.decision()?.seat === 'Alice');
    expect(saved.seats[1].minions.find((m: {id:string}) => m.id === 'M').blood).toBe(6);
    expect(saved.eventLog.some((e: {type:string}) => e.type === 'StrikeChosen')).toBe(false);
  });
  it("limits superior per vampire per round, not per combat", () => {
    const {state, engine} = game();
    const first=find(engine,"play:Outside the Hourglass:superior:V1");
    expect(first).toBeDefined(); engine.choose(first!.id);
    // Resolve its as-played window and return to before-range.
    walk(engine, () => engine.decision()?.window === 'combat.beforeRange' && engine.decision()?.seat === 'Alice');
    expect(find(engine,"play:Outside the Hourglass:superior:V1")).toBeUndefined();
    engine.choose('pass');
    expect(engine.decision()?.seat).toBe('Bob');
    expect(find(engine,"play:Outside the Hourglass:superior:M")).toBeDefined();
    const saved=JSON.parse(JSON.stringify(state));
    const resumed=new VtesEngine(saved,testRegistry);
    expect(find(resumed,"play:Outside the Hourglass:superior:M")).toBeDefined();
  });
});
