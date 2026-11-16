import { describe, expect, it } from "vitest";
import { currentStealth, titleContestKey, VtesEngine } from "../../src/engine/index.ts";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function attach(m: MinionState, name: string, id: string) {
  const entry = testRegistry[name]!.cryptEntry!();
  m.attached.push({ card: { id, name }, locked: false, usedThisPhase: false, statics: entry.statics, tags: entry.tags });
}
function walk(engine: VtesEngine, predicate: () => boolean, limit = 50) {
  for (let i = 0; i < limit && !predicate(); i++) {
    const dp = engine.decision()!;
    const option = dp.options.find(o => o.id === "pass");
    if (!option) throw new Error(`cannot pass ${dp.window}: ${dp.options.map(o => o.id)}`);
    engine.choose(option.id);
  }
  if (!predicate()) throw new Error("target not reached");
}
function options(engine: VtesEngine) { return engine.decision()!.options; }
const pass3: Array<[string, string]> = [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]];

function pollingGustav() {
  const state = threeSeatGame();
  const gustav = state.seats[1]!.minions.find(m => m.id === "W")!;
  gustav.title = "prince"; gustav.titleCity = "Berlin";
  attach(gustav, "Gustav Breidenstein (G4)", "gustav");
  state.seats[0]!.hand.push({ id: "au", name: "Anarchist Uprising" });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [["Alice", "play:Anarchist Uprising"], ...pass3, ...pass3, ...pass3, ...pass3]);
  walk(engine, () => engine.decision()?.seat === "Bob");
  return { state, gustav, engine };
}
const gustavOption = "ability:Gustav Breidenstein (G4):gustav:votes";

describe("Gustav Breidenstein (G4)", () => {
  it("locks himself for five personal votes in another Methuselah's referendum", () => {
    const { state, gustav, engine } = pollingGustav();
    expect(options(engine).some(o => o.id === gustavOption)).toBe(true);
    const restored = JSON.parse(JSON.stringify(state)) as GameState;
    const e = new VtesEngine(restored, testRegistry);
    e.choose(gustavOption);
    expect(restored.seats[1]!.minions.find(m => m.id === gustav.id)!.locked).toBe(true);
    walk(e, () => e.decision()?.seat === "Bob");
    const vote = options(e).find(o => o.id === "vote:W:for");
    expect(vote && vote.kind === "castVote" && vote.count).toBe(7); // prince + 5
    expect(options(e).some(o => o.id === gustavOption)).toBe(false);
    e.choose("vote:W:for");
    const ref = restored.frames.find(f => f.kind === "referendum");
    expect(ref?.kind === "referendum" && ref.votes).toEqual(expect.arrayContaining([expect.objectContaining({ minion: "W", count: 7, inFavor: true })]));
  });
  it("does not offer the ability while locked or in torpor", () => {
    const { gustav, engine } = pollingGustav();
    gustav.locked = true;
    expect(options(engine).some(o => o.id === gustavOption)).toBe(false);
    gustav.locked = false; gustav.inTorpor = true;
    expect(options(engine).some(o => o.id === gustavOption)).toBe(false);
  });
  it("votes gained after he has voted follow his existing direction", () => {
    const { engine } = pollingGustav();
    engine.choose("vote:W:against");
    walk(engine, () => engine.decision()?.seat === "Bob");
    engine.choose(gustavOption);
    walk(engine, () => engine.decision()?.seat === "Bob");
    expect(options(engine).some(o => o.id === "vote:W:for")).toBe(false);
    const vote = options(engine).find(o => o.id === "vote:W:against");
    expect(vote && vote.kind === "castVote" && vote.count).toBe(5);
  });
});

const horatioOption = "act:Horatio Ballard (G3):horatio:prince";
function horatio() {
  const state = threeSeatGame();
  const m = state.seats[0]!.minions[0]!;
  m.title = null; m.sect = "camarilla";
  attach(m, "Horatio Ballard (G3)", "horatio");
  const engine = new VtesEngine(state, testRegistry);
  return { state, m, engine };
}
function toHoratioPolling(engine: VtesEngine, state: GameState) {
  engine.choose(horatioOption);
  walk(engine, () => state.frames.some(f => f.kind === "referendum" && f.step === "polling"));
}
function finishReferendum(engine: VtesEngine, state: GameState) {
  walk(engine, () => !state.frames.some(f => f.kind === "referendum"));
}

describe("Horatio Ballard (G3)", () => {
  it("does not give unrelated actions stealth, but his political action gets +1", () => {
    const { state, engine } = horatio();
    engine.choose("bleed:V1");
    const af = state.frames.find(f => f.kind === "action")!;
    expect(af.kind === "action" && currentStealth(state, af.actionId)).toBe(0);
    const next = horatio();
    expect(options(next.engine).some(o => o.id === horatioOption)).toBe(true);
    next.engine.choose(horatioOption);
    const action = next.state.frames.find(f => f.kind === "action")!;
    expect(action.kind === "action" && currentStealth(next.state, action.actionId)).toBe(1);
    expect(action.kind === "action" && action.political).toBe(true);
    expect(action.kind === "action" && action.directed).toBe(false);
  });
  it("requires Camarilla, no title, readiness and no previous political action", () => {
    const { m, engine } = horatio();
    m.sect = "anarch"; expect(options(engine).some(o => o.id === horatioOption)).toBe(false);
    m.sect = "camarilla"; m.title = "primogen"; expect(options(engine).some(o => o.id === horatioOption)).toBe(false);
    m.title = null; m.locked = true; expect(options(engine).some(o => o.id === horatioOption)).toBe(false);
    m.locked = false; m.calledPoliticalThisTurn = true; expect(options(engine).some(o => o.id === horatioOption)).toBe(false);
  });
  it("has no free calling-card vote, and grants Chicago only after a passed referendum", () => {
    const { state, m, engine } = horatio();
    const voter = makeMinion("voter", "Alice"); voter.title = "primogen";
    state.seats[0]!.minions.push(voter);
    toHoratioPolling(engine, state);
    expect(options(engine).some(o => o.id === "vote:caller:for")).toBe(false);
    expect(m.title).toBeNull();
    engine.choose("vote:voter:for");
    finishReferendum(engine, state);
    expect(m.title).toBe("prince"); expect(m.titleCity).toBe("Chicago");
    expect(titleContestKey(m)).toBe("city:chicago");
    m.locked = false;
    expect(options(engine).some(o => o.id === horatioOption)).toBe(false);
  });
  it("can burn a political action card for a vote when his action provided no calling card", () => {
    const { state, m, engine } = horatio();
    state.seats[0]!.hand.push({ id: "au", name: "Anarchist Uprising" });
    toHoratioPolling(engine, state);
    expect(options(engine).some(o => o.id === "vote:card:au:for")).toBe(true);
    engine.choose("vote:card:au:for");
    finishReferendum(engine, state);
    expect(m.title).toBe("prince");
    expect(state.seats[0]!.ashHeap?.some(c => c.id === "au")).toBe(true);
  });
  it("a failed referendum grants no title", () => {
    const { state, m, engine } = horatio();
    toHoratioPolling(engine, state);
    finishReferendum(engine, state);
    expect(m.title).toBeNull();
  });
  it("does not grant a Camarilla title if Horatio changes sect during polling", () => {
    const { state, m, engine } = horatio();
    const voter = makeMinion("voter", "Alice"); voter.title = "primogen"; state.seats[0]!.minions.push(voter);
    toHoratioPolling(engine, state);
    m.sect = "sabbat";
    engine.choose("vote:voter:for");
    finishReferendum(engine, state);
    expect(m.title).toBeNull();
  });
  it("has no referendum if blocked", () => {
    const { state, engine } = horatio();
    // His +1 stealth is met by Bob's intercept.
    state.seats[1]!.minions.find(m => m.id === "W")!.attached.push({
      card: { id: "intercept", name: "fixture" }, locked: false, usedThisPhase: false,
      statics: { intercept: 1 }, tags: [],
    });
    engine.choose(horatioOption);
    walk(engine, () => options(engine).some(o => o.id === "block:W"));
    engine.choose("block:W");
    walk(engine, () => state.frames.some(f => f.kind === "combat"));
    expect(state.frames.some(f => f.kind === "referendum")).toBe(false);
    expect(state.seats[0]!.minions[0]!.title).toBeNull();
  });
  it("a passed referendum contests another vampire's Chicago title", () => {
    const { state, m, engine } = horatio();
    const voter = makeMinion("voter", "Alice"); voter.title = "primogen"; state.seats[0]!.minions.push(voter);
    const rival = state.seats[1]!.minions[0]!; rival.title = "archbishop"; rival.titleCity = "Chicago";
    toHoratioPolling(engine, state);
    engine.choose("vote:voter:for");
    finishReferendum(engine, state);
    engine.decision();
    expect(m.titleContest).toEqual({ title: "prince", city: "Chicago" });
    expect(rival.titleContest).toEqual({ title: "archbishop", city: "Chicago" });
  });
});
