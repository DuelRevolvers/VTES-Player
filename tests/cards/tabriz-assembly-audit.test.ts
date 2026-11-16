import { describe, expect, it } from "vitest";
import { currentStealth, VtesEngine, type GameState } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function setup() {
  const state = threeSeatGame();
  state.seats[0]!.permanents.push({ card: { id: "tab", name: "Tabriz Assembly" }, locked: false,
    usedThisPhase: false, statics: { handSize: 1 }, tags: ["location"] });
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn");
  tf.seat = "Bob";
  return { state, engine: new VtesEngine(state, testRegistry) };
}
function toPolling(engine: VtesEngine) {
  runTrace(engine, [["Bob", "act:Tabriz Assembly:tab:vote:W"],
    ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"],
    ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"],
    ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"]]);
  expect(engine.decision()?.window).toBe("referendum.polling");
}
function walkTo(engine: VtesEngine, seat: string) {
  for (let i = 0; i < 5 && engine.decision()?.seat !== seat; i++) engine.choose("pass");
  return engine.decision()!;
}
describe("Tabriz Assembly", () => {
  it("allows any vampire's +1 stealth political action to burn it", () => {
    const { state, engine } = setup();
    engine.choose("act:Tabriz Assembly:tab:vote:W");
    const af = state.frames.find(f => f.kind === "action");
    if (af?.kind !== "action") throw new Error("no action");
    expect(af.directed).toBe(false);
    expect(currentStealth(state, af.actionId)).toBe(1);
    expect(state.seats[1]!.minions.find(m => m.id === "W")!.calledPoliticalThisTurn).toBe(true);
  });
  it("grants its controller one vote in this referendum, can vote against and is burned on a pass", () => {
    const { state, engine } = setup();
    state.seats[1]!.minions.find(m => m.id === "W")!.title = "prince";
    toPolling(engine);
    expect(engine.decision()!.options.some(o => o.id === "vote:grant:tab:for")).toBe(false);
    engine.choose("vote:W:for");
    const alice = walkTo(engine, "Alice");
    expect(alice.options.find(o => o.id === "vote:grant:tab:against")).toMatchObject({ count: 1 });
    const saved = JSON.parse(JSON.stringify(state)) as GameState;
    const e = new VtesEngine(saved, testRegistry);
    e.choose("vote:grant:tab:against");
    expect(saved.frames.find(f => f.kind === "referendum")).toMatchObject({ votes: expect.arrayContaining([expect.objectContaining({ count: 1, inFavor: false })]) });
    // Caller can carry two votes in this separate run, so one opposing vote does not save it.
    const pass = setup();
    pass.state.seats[1]!.minions.find(m => m.id === "W")!.title = "prince";
    toPolling(pass.engine);
    pass.engine.choose("vote:W:for");
    for (let i = 0; i < 10 && pass.state.frames.some(f => f.kind === "referendum"); i++) pass.engine.choose("pass");
    expect(pass.state.seats[0]!.permanents.some(p => p.card.id === "tab")).toBe(false);
  });
  it("leaves the card in play when the referendum fails", () => {
    const { state, engine } = setup();
    toPolling(engine);
    const dp = walkTo(engine, "Alice");
    expect(dp.options.some(o => o.id === "vote:grant:tab:against")).toBe(true);
    engine.choose("vote:grant:tab:against");
    for (let i = 0; i < 8 && state.frames.some(f => f.kind === "referendum"); i++) engine.choose("pass");
    expect(state.seats[0]!.permanents.some(p => p.card.id === "tab")).toBe(true);
    expect(state.eventLog.find(e => e.type === "ReferendumResolved")).toMatchObject({ passed: false });
  });
  it("the passive vote disappears when the source leaves play and follows its controller", () => {
    const x = setup(); toPolling(x.engine); walkTo(x.engine, "Alice");
    expect(x.engine.decision()!.options.some(o => o.id === "vote:grant:tab:for")).toBe(true);
    x.engine.burnPermanent("tab");
    expect(x.engine.decision()!.options.some(o => o.id === "vote:grant:tab:for")).toBe(false);
    const y = setup(); toPolling(y.engine);
    y.engine.changePermanentControl("tab", "Carol");
    expect(y.engine.decision()!.options.some(o => o.id === "vote:grant:tab:for")).toBe(false);
    y.engine.choose("pass");
    const dp = walkTo(y.engine, "Carol");
    expect(dp.options.some(o => o.id === "vote:grant:tab:for")).toBe(true);
  });
  it("does not grant votes in an unrelated referendum", () => {
    const { state } = setup();
    const tf = state.frames[0]!; if (tf.kind !== "turn") throw new Error("no turn"); tf.seat = "Alice";
    state.seats[0]!.hand.push({ id: "au", name: "Anarchist Uprising" });
    const e = new VtesEngine(state, testRegistry);
    runTrace(e, [["Alice", "play:Anarchist Uprising"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(e.decision()!.window).toBe("referendum.polling");
    expect(e.decision()!.options.some(o => o.id.startsWith("vote:grant:tab:"))).toBe(false);
  });
});

describe("Tabriz Assembly requirements and blood", () => {
  it("requires a ready True Brujah to play, and has a burn option without a matching minion", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!; if (tf.kind !== "turn") throw new Error("no turn");
    tf.phase = "master"; tf.masterActionsLeft = 1;
    state.seats[0]!.hand.push({ id: "tab", name: "Tabriz Assembly" });
    const e = new VtesEngine(state, testRegistry);
    expect(e.decision()!.options.some(o => o.id.startsWith("play:Tabriz Assembly"))).toBe(false);
    const card = testRegistry["Tabriz Assembly"]!;
    expect(card.burnOptionDiscardable!(state, "Alice")).toBe(true);
    const m = state.seats[0]!.minions[0]!;
    m.clan = "True Brujah"; m.inTorpor = true;
    expect(card.burnOptionDiscardable!(state, "Alice")).toBe(false);
    expect(e.decision()!.options.some(o => o.id.startsWith("play:Tabriz Assembly"))).toBe(false);
    m.inTorpor = false;
    expect(e.decision()!.options.some(o => o.id.startsWith("play:Tabriz Assembly"))).toBe(true);
  });
  it("feeds a True Brujah independently of the hunting ground limit, including one in torpor", () => {
    const { state } = setup();
    const tf = state.frames[0]!; if (tf.kind !== "turn") throw new Error("no turn");
    Object.assign(tf, { seat: "Alice", phase: "unlock", unlockDone: false, unlockAbilitiesDone: false });
    const m = state.seats[0]!.minions[0]!;
    Object.assign(m, { clan: "True Brujah", blood: 1, inTorpor: true, usedHuntingGroundThisTurn: true });
    const e = new VtesEngine(state, testRegistry);
    e.decision(); // turn-start cleanup runs before the unlock abilities
    m.usedHuntingGroundThisTurn = true;
    expect(e.decision()!.options.some(o => o.id === "ability:Tabriz Assembly:tab:V1")).toBe(true);
    e.choose("ability:Tabriz Assembly:tab:V1");
    expect(m.blood).toBe(2);
    expect(m.usedHuntingGroundThisTurn).toBe(true);
    expect(e.decision()!.options.some(o => o.id === "ability:Tabriz Assembly:tab:V1")).toBe(false);
  });
  it("does not consume the vampire's hunting-ground use", () => {
    const { state } = setup();
    const tf = state.frames[0]!; if (tf.kind !== "turn") throw new Error("no turn");
    Object.assign(tf, { seat: "Alice", phase: "unlock", unlockDone: false, unlockAbilitiesDone: false });
    const m = state.seats[0]!.minions[0]!;
    Object.assign(m, { clan: "True Brujah", blood: 1, usedHuntingGroundThisTurn: false });
    state.seats[0]!.permanents.push({ card: { id: "hg", name: "Academic Hunting Ground" }, locked: false,
      usedThisPhase: false, statics: {}, tags: ["location", "huntingGround"] });
    const e = new VtesEngine(state, testRegistry);
    e.choose("ability:Tabriz Assembly:tab:V1");
    expect(m.usedHuntingGroundThisTurn).toBe(false);
    expect(e.decision()!.options.some(o => o.id === "ability:Academic Hunting Ground:hg:V1")).toBe(true);
    e.choose("ability:Academic Hunting Ground:hg:V1");
    expect(m.blood).toBe(3);
  });
});
