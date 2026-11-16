/** Post-block reaction unlocks, and their timing after the combat. */
import { describe, expect, it } from "vitest";
import { VtesEngine, type GameState } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function blocked(name: string) {
  const state = threeSeatGame();
  const actor = state.seats[0]!.minions[0]!;
  actor.strength = 0;
  const blocker = state.seats[1]!.minions.find(x => x.id === "M")!;
  Object.assign(blocker, { disciplines: { ani: "superior", for: "superior" }, blood: 5, strength: 0 });
  state.seats[1]!.hand.push({ id: "unlock", name });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"]]);
  return { state, engine, blocker };
}
function options(e: VtesEngine) { return e.decision()!.options.map(x => x.id); }
function until(e: VtesEngine, predicate: () => boolean) {
  for (let i = 0; i < 150 && !predicate(); i++) {
    const dp = e.decision()!;
    const p = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand");
    if (!p) throw new Error(`No pass or strike at ${dp.window}`);
    e.choose(p.id);
  }
  expect(predicate()).toBe(true);
}

describe.each(["Cats' Guidance", "Forced Vigilance"])("%s basic after block", (name) => {
  it("is not available in combat, but is offered after the combat ends", () => {
    const { state, engine, blocker } = blocked(name);
    expect(engine.decision()!.window).toBe("combat.beforeRange");
    expect(options(engine).some(id => id.startsWith(`play:${name}:basic`))).toBe(false);
    until(engine, () => engine.decision()?.window === "action.afterResolution" && engine.decision()?.seat === "Bob");
    expect(state.eventLog.some(e => e.type === "CombatEnded")).toBe(true);
    const id = options(engine).find(x => x.startsWith(`play:${name}:basic:M`));
    expect(id).toBeDefined();
    engine.choose(id!);
    until(engine, () => !blocker.locked);
    expect(blocker.locked).toBe(false);
  });
  it("cannot be played by a vampire in torpor after combat", () => {
    const { engine, blocker } = blocked(name);
    // Reproduce the combat outcome without relying on a particular strike.
    blocker.inTorpor = true;
    for (let i = 0; i < 150 && engine.state.frames.some(f => f.kind === "action"); i++) {
      const dp = engine.decision()!;
      expect(dp.options.some(o => o.id.startsWith(`play:${name}:basic`))).toBe(false);
      const p = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand");
      if (!p) throw new Error(`No pass or strike at ${dp.window}`);
      engine.choose(p.id);
    }
    expect(engine.state.frames.some(f => f.kind === "action")).toBe(false);
  });
  it("does not offer the unlock after combat when Sleeping Mind prohibits it", () => {
    const { state, engine } = blocked(name);
    const af = state.frames.find(f => f.kind === "action");
    if (!af || af.kind !== "action") throw new Error("no action");
    af.noUnlock = true;
    for (let i = 0; i < 150 && state.frames.some(f => f.kind === "action"); i++) {
      const dp = engine.decision()!;
      expect(dp.options.some(o => o.id.startsWith(`play:${name}:basic:M`))).toBe(false);
      const p = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand");
      if (!p) throw new Error(`No pass or strike at ${dp.window}`);
      engine.choose(p.id);
    }
    expect(state.frames.some(f => f.kind === "action")).toBe(false);
  });
  it("does not offer the unlock before an already queued follow-up combat", () => {
    const { state, engine } = blocked(name);
    const af = state.frames.find(f => f.kind === "action");
    if (!af || af.kind !== "action") throw new Error("no action");
    af.queuedCombats.push({ a: "V1", b: "M" });
    until(engine, () => state.eventLog.filter(e => e.type === "CombatBegan").length === 2);
    expect(state.eventLog.filter(e => e.type === "CombatEnded")).toHaveLength(1);
    expect(options(engine).some(id => id.startsWith(`play:${name}:basic:M`))).toBe(false);
    until(engine, () => engine.decision()?.window === "action.afterResolution" && engine.decision()?.seat === "Bob");
    expect(state.eventLog.filter(e => e.type === "CombatEnded")).toHaveLength(2);
    expect(options(engine).some(id => id.startsWith(`play:${name}:basic:M`))).toBe(true);
  });
  it("is still offered when Ghoul Escort skips the combat after a successful block", () => {
    const state = threeSeatGame();
    const actor=state.seats[0]!.minions[0]!;
    actor.attached.push({card:{id:'escort',name:'Ghoul Escort'},locked:false,usedThisPhase:false,
      tags:testRegistry['Ghoul Escort']!.permanentTags ?? [],statics:testRegistry['Ghoul Escort']!.permanentStatics ?? {},life:4});
    const blocker=state.seats[1]!.minions.find(m=>m.id==='M')!;
    blocker.disciplines={ani:'superior',for:'superior'};blocker.blood=5;
    state.seats[1]!.hand.push({id:'unlock',name});
    const engine=new VtesEngine(state,testRegistry);
    runTrace(engine,[["Alice","bleed:V1"],["Alice","pass"],["Bob","pass"],["Carol","pass"],
      ["Alice","pass"],["Bob","block:M"],["Alice","pass"],["Bob","pass"],["Carol","pass"]]);
    until(engine,()=>options(engine).includes('ability:Ghoul Escort:escort:escort'));
    engine.choose('ability:Ghoul Escort:escort:escort');
    until(engine,()=>engine.decision()?.window==='action.afterResolution' && engine.decision()?.seat==='Bob');
    expect(state.eventLog.some(e=>e.type==='CombatCancelled')).toBe(true);
    expect(options(engine).some(id=>id.startsWith(`play:${name}:basic:M`))).toBe(true);
  });
  it("preserves the after-combat opportunity across save/load", () => {
    const { state, engine } = blocked(name);
    until(engine, () => engine.decision()?.window === "action.afterResolution" && engine.decision()?.seat === "Bob");
    const copy = JSON.parse(JSON.stringify(state)) as GameState;
    const resumed = new VtesEngine(copy, testRegistry);
    expect(options(resumed).some(x => x.startsWith(`play:${name}:basic:M`))).toBe(true);
  });
});

describe("Forced Vigilance superior", () => {
  it("unlocks a locked vampire during a directed action so it can block", () => {
    const state = threeSeatGame();
    const m = state.seats[1]!.minions.find(x => x.id === "M")!;
    Object.assign(m, { disciplines: { for: "superior" }, blood: 2, locked: true });
    state.seats[1]!.hand.push({ id: "fv1", name: "Forced Vigilance" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "play:Forced Vigilance:superior:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"]]);
    expect(m.locked).toBe(false);
    expect(options(engine)).toContain("block:M");
  });
});
