import { describe, expect, it } from "vitest";
import { VtesEngine, type GameState } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function setup() {
  const state = threeSeatGame();
  const alice = state.seats[0]!;
  const bob = state.seats[1]!;
  Object.assign(alice.minions[0]!, { blood: 10, capacity: 10, sect: "anarch", disciplines: { cel: "superior", pro: "superior", obt: "superior" } });
  Object.assign(bob.minions.find((m) => m.id === "M")!, { blood: 10, capacity: 10, sect: "anarch", disciplines: { cel: "superior" } });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  return { state, engine };
}
function combat(state: GameState) {
  const cf = state.frames.find((f) => f.kind === "combat");
  if (!cf || cf.kind !== "combat") throw new Error("no combat");
  return cf;
}
function advanceTo(engine: VtesEngine, window: string, seat?: string) {
  for (let i = 0; i < 100; i++) {
    const dp = engine.decision();
    if (!dp) throw new Error("game ended");
    if (dp.window === window && (!seat || dp.seat === seat)) return dp;
    const choice = dp.options.find((o) => o.id === "pass") ?? dp.options.find((o) => o.id === "strike:hand");
    if (!choice) throw new Error(`no pass or hand in ${dp.window} for ${dp.seat}`);
    engine.choose(choice.id);
  }
  throw new Error(`did not reach ${window} ${seat}`);
}
function play(engine: VtesEngine, prefix: string) {
  const dp = engine.decision()!;
  const option = dp.options.find((o) => o.id.startsWith(prefix));
  if (!option) throw new Error(`missing ${prefix} in ${dp.window}: ${dp.options.map((o) => o.id).join(", ")}`);
  engine.choose(option.id);
  while (engine.decision()?.window === "card.asPlayed") engine.choose("pass");
}
function has(engine: VtesEngine, prefix: string) {
  return engine.decision()!.options.some((o) => o.id.startsWith(prefix));
}

describe("limited additional strike sources per combatant and round", () => {
  it("does not offer a second Diversion or another limited card after Diversion resolves", () => {
    const { state, engine } = setup();
    state.seats[0]!.hand.push({ id: "d1", name: "Diversion" }, { id: "d2", name: "Diversion" }, { id: "b1", name: "Blur" }, { id: "q1", name: "Quickness" });
    advanceTo(engine, "combat.grantAdditionalStrikes", "Alice");
    play(engine, "play:Diversion:basic:V1:cel:d1");
    advanceTo(engine, "combat.grantAdditionalStrikes", "Alice");
    expect(combat(state).additionalStrikes.acting).toBe(1);
    expect(combat(state).usedLimitedAddl.acting).toBe(true);
    expect(has(engine, "play:Diversion:basic:V1:cel:d2")).toBe(false);
    expect(has(engine, "play:Blur")).toBe(false);
  });

  it("allows an opposing minion its own limited source in the same round", () => {
    const { state, engine } = setup();
    state.seats[0]!.hand.push({ id: "d1", name: "Diversion" });
    state.seats[1]!.hand.push({ id: "d2", name: "Diversion" }, { id: "d3", name: "Diversion" });
    advanceTo(engine, "combat.grantAdditionalStrikes", "Alice");
    play(engine, "play:Diversion:basic:V1:cel:d1");
    expect(engine.decision()!.seat).toBe("Bob");
    expect(has(engine, "play:Diversion:basic:M:cel:d2")).toBe(true);
    play(engine, "play:Diversion:basic:M:cel:d2");
    expect(combat(state).usedLimitedAddl).toEqual({ acting: true, opposing: true });
    advanceTo(engine, "combat.grantAdditionalStrikes", "Bob");
    expect(has(engine, "play:Diversion:basic:M:cel:d3")).toBe(false);
  });

  it("a non-limited Quickness does not consume the limited slot", () => {
    const { state, engine } = setup();
    state.seats[0]!.hand.push({ id: "d1", name: "Diversion" }, { id: "q1", name: "Quickness" });
    advanceTo(engine, "combat.grantAdditionalStrikes", "Alice");
    play(engine, "play:Quickness:superior");
    expect(combat(state).usedLimitedAddl.acting).toBe(false);
  });

  it("resets the limit for a new round and only gets one strike from Diversion", () => {
    const { state, engine } = setup();
    state.seats[0]!.hand.push({ id: "d1", name: "Diversion" }, { id: "d2", name: "Diversion" });
    advanceTo(engine, "combat.grantAdditionalStrikes", "Alice");
    play(engine, "play:Diversion:basic:V1:cel:d1");
    combat(state).presses.acting = 1;
    advanceTo(engine, "combat.press", "Alice");
    expect(state.eventLog.filter((e) => e.type === "StrikeChosen" && e.minion === "V1")).toHaveLength(2);
    engine.choose("press:continue");
    for (let i = 0; i < 50 && combat(state).round === 1; i++) {
      const dp = engine.decision()!;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    expect(combat(state).round).toBe(2);
    expect(combat(state).usedLimitedAddl.acting).toBe(false);
    advanceTo(engine, "combat.grantAdditionalStrikes", "Alice");
    expect(has(engine, "play:Diversion:basic:V1:cel:d2")).toBe(true);
  });

  it("does not allow a second limited before-range credit", () => {
    const { state, engine } = setup();
    state.seats[0]!.hand.push({ id: "s1", name: "Shadow of the Wolf" }, { id: "s2", name: "Shadow of the Wolf" });
    advanceTo(engine, "combat.beforeRange", "Alice");
    play(engine, "play:Shadow of the Wolf:basic:V1:s1");
    advanceTo(engine, "combat.beforeRange", "Alice");
    expect(combat(state).usedLimitedAddl.acting).toBe(true);
    expect(has(engine, "play:Shadow of the Wolf:basic:V1:s2")).toBe(false);
    expect(has(engine, "play:Shadow of the Wolf:superior:V1:s2")).toBe(false);
  });

  it("a canceled strike card does not reserve a limited source through its history", () => {
    const { state, engine } = setup();
    state.seats[0]!.hand.push({ id: "arms", name: "Arms of the Abyss" }, { id: "blur", name: "Blur" });
    state.seats[2]!.hand.push({ id: "di", name: "Direct Intervention" });
    advanceTo(engine, "combat.chooseStrike", "Alice");
    engine.choose(engine.decision()!.options.find((o) => o.id.startsWith("play:Arms of the Abyss:superior"))!.id);
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "play:Direct Intervention"]]);
    while (engine.decision()?.window === "card.asPlayed") engine.choose("pass");
    advanceTo(engine, "combat.grantAdditionalStrikes", "Alice");
    expect(combat(state).usedLimitedAddl.acting).toBe(false);
    expect(has(engine, "play:Blur")).toBe(true);
  });

  it("a canceled grant does not consume the limit", () => {
    const { state, engine } = setup();
    state.seats[0]!.hand.push({ id: "d1", name: "Diversion" }, { id: "d2", name: "Diversion" });
    state.seats[2]!.hand.push({ id: "di", name: "Direct Intervention" });
    advanceTo(engine, "combat.grantAdditionalStrikes", "Alice");
    engine.choose(engine.decision()!.options.find((o) => o.id.startsWith("play:Diversion:basic:V1:cel:d1"))!.id);
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "play:Direct Intervention"]]);
    while (engine.decision()?.window === "card.asPlayed") engine.choose("pass");
    advanceTo(engine, "combat.grantAdditionalStrikes", "Alice");
    expect(combat(state).usedLimitedAddl.acting).toBe(false);
    expect(combat(state).additionalStrikes.acting).toBe(0);
    expect(has(engine, "play:Diversion:basic:V1:cel:d2")).toBe(true);
  });

  it("AK-47 equipped is offered in grantAdditionalStrikes alongside Blur from hand", () => {
    const { state, engine } = setup();
    // Equip AK-47 on V1
    const v1 = state.seats[0]!.minions[0]!;
    const ak47 = testRegistry["AK-47"];
    v1.attached.push({
      card: { id: "ak", name: "AK-47" },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: ak47?.permanentStatics ?? {},
      tags: ak47?.permanentTags ?? [],
    });
    state.seats[0]!.hand.push({ id: "bl", name: "Blur" });
    advanceTo(engine, "combat.grantAdditionalStrikes", "Alice");
    // Both AK-47 (as ability) and Blur (from hand) should be offered
    expect(has(engine, "ability:AK-47:ak:additionalStrike")).toBe(true);
    expect(has(engine, "play:Blur")).toBe(true);
  });

  it("after Blur (limited) is taken in grant window, AK-47 is no longer offered", () => {
    const { state, engine } = setup();
    const v1 = state.seats[0]!.minions[0]!;
    const ak47 = testRegistry["AK-47"];
    v1.attached.push({
      card: { id: "ak", name: "AK-47" },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: ak47?.permanentStatics ?? {},
      tags: ak47?.permanentTags ?? [],
    });
    state.seats[0]!.hand.push({ id: "bl", name: "Blur" });
    advanceTo(engine, "combat.grantAdditionalStrikes", "Alice");
    play(engine, "play:Blur");
    expect(combat(state).usedLimitedAddl.acting).toBe(true);
    // Advance past Bob's decline to get back to Alice
    advanceTo(engine, "combat.grantAdditionalStrikes", "Alice");
    expect(has(engine, "ability:AK-47:ak:additionalStrike")).toBe(false);
    expect(has(engine, "play:Blur")).toBe(false);
  });

  it("after AK-47 (limited) is taken in grant window, Blur is no longer offered", () => {
    const { state, engine } = setup();
    const v1 = state.seats[0]!.minions[0]!;
    const ak47 = testRegistry["AK-47"];
    v1.attached.push({
      card: { id: "ak", name: "AK-47" },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: ak47?.permanentStatics ?? {},
      tags: ak47?.permanentTags ?? [],
    });
    state.seats[0]!.hand.push({ id: "bl", name: "Blur" });
    advanceTo(engine, "combat.grantAdditionalStrikes", "Alice");
    play(engine, "ability:AK-47:ak:additionalStrike");
    expect(combat(state).usedLimitedAddl.acting).toBe(true);
    // Advance past Bob's decline to get back to Alice
    advanceTo(engine, "combat.grantAdditionalStrikes", "Alice");
    expect(has(engine, "ability:AK-47:ak:additionalStrike")).toBe(false);
    expect(has(engine, "play:Blur")).toBe(false);
  });
});
