import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import type { GameState } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function actionSetup(card: string, disc: Record<string, "basic" | "superior">) {
  const state = threeSeatGame();
  Object.assign(state.seats[0]!.minions[0]!, { disciplines: disc, blood: 5, capacity: 8, strength: 1 });
  state.seats[0]!.hand.push({ id: "fix", name: card });
  return { state, engine: new VtesEngine(state, testRegistry) };
}
function announce(engine: VtesEngine) {
  runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
}
function settleCard(engine: VtesEngine) {
  for (let i = 0; i < 5 && engine.decision()?.window === "card.asPlayed"; i++) engine.choose("pass");
}
function walk(engine: VtesEngine, window: string, seat = "Alice") {
  for (let i = 0; i < 40; i++) {
    const d = engine.decision();
    if (!d) throw new Error(`no decision for ${window}`);
    if (d.window === window && d.seat === seat) return d;
    const pick = d.options.find((o) => o.id === "pass") ?? d.options.find((o) => o.id === "strike:hand");
    if (!pick) throw new Error(`cannot advance ${d.window} ${d.seat}`);
    engine.choose(pick.id);
  }
  throw new Error(`did not reach ${window} ${seat}`);
}
function combat(state: GameState) {
  const cf = state.frames.find((f) => f.kind === "combat");
  if (!cf || cf.kind !== "combat") throw new Error("no combat");
  return cf;
}

describe("Veil the Legions", () => {
  function setup(blood: number, tax = 0) {
    const a = actionSetup("Veil the Legions", {});
    const helper = makeMinion("V2", "Alice", { disciplines: { obf: "superior" }, blood, capacity: 10 });
    if (tax) helper.attached.push({ card: { id: "tax", name: "test tax" }, locked: false, usedThisPhase: false, tags: [], statics: { playCostMod: { amount: tax, pays: "blood", cardName: "Veil the Legions", minions: "bearer" } } });
    a.state.seats[0]!.minions.push(helper);
    announce(a.engine);
    runTrace(a.engine, [["Alice", "pass"], ["Bob", "block:M"]]);
    return { ...a, helper };
  }
  it("offers the complete affordable range and spends X greater than three", () => {
    const a = setup(7);
    const ids = a.engine.decision()!.options.map((o) => o.id);
    for (let x = 0; x <= 7; x++) expect(ids).toContain(`play:Veil the Legions:superior:V2:${x}:fix`);
    expect(ids).not.toContain("play:Veil the Legions:superior:V2:8:fix");
    a.engine.choose("play:Veil the Legions:superior:V2:6:fix");
    settleCard(a.engine);
    expect(a.helper.blood).toBe(1);
    expect(a.state.seats[0]!.stealthCharges).toBe(6);
  });
  it("reserves the modified play cost before offering X", () => {
    const a = setup(7, 2);
    const ids = a.engine.decision()!.options.map((o) => o.id);
    expect(ids).toContain("play:Veil the Legions:superior:V2:5:fix");
    expect(ids).not.toContain("play:Veil the Legions:superior:V2:6:fix");
    a.engine.choose("play:Veil the Legions:superior:V2:5:fix");
    settleCard(a.engine);
    expect(a.helper.blood).toBe(0);
    expect(a.state.seats[0]!.stealthCharges).toBe(5);
  });
});

describe("announcement modifiers", () => {
  it("Seduction is offered at announcement but not during a block attempt", () => {
    const a = actionSetup("Seduction", { dom: "superior" });
    announce(a.engine);
    expect(a.engine.decision()!.options.some((o) => o.id.startsWith("play:Seduction:superior:"))).toBe(true);
    runTrace(a.engine, [["Alice", "pass"], ["Bob", "block:M"]]);
    expect(a.engine.decision()!.options.some((o) => o.id.startsWith("play:Seduction:"))).toBe(false);
  });
  it("Seduction is not offered in state A reopened by a failed block", () => {
    const a = actionSetup("Seduction", { dom: "superior", obf: "basic" });
    a.state.seats[0]!.hand.push({ id: "lost", name: "Lost in Crowds" });
    announce(a.engine);
    runTrace(a.engine, [["Alice", "pass"], ["Bob", "block:M"], ["Alice", "play:Lost in Crowds:basic"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    const af = a.state.frames.find((f) => f.kind === "action");
    expect(af?.kind === "action" && af.step).toBe("A");
    expect(a.engine.decision()!.options.some((o) => o.id.startsWith("play:Seduction:"))).toBe(false);
  });
  it.each([["basic", 1], ["superior", 2]] as const)("Serenading %s adds %i strength in blocked combat", (mode, bonus) => {
    const a = actionSetup("Serenading the Kami", { tha: "superior" });
    announce(a.engine);
    const id = `play:Serenading the Kami:${mode}:V1:fix`;
    expect(a.engine.decision()!.options.map((o) => o.id)).toContain(id);
    a.engine.choose(id);
    settleCard(a.engine);
    expect(a.state.seats[0]!.minions[0]!.blood).toBe(4);
    runTrace(a.engine, [["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(combat(a.state).strengthBonus.acting).toBe(bonus);
    walk(a.engine, "combat.chooseStrike");
    a.engine.choose("strike:hand");
    a.engine.choose("strike:hand");
    expect(a.state.eventLog.some((e) => e.type === "DamageInflicted" && e.minion === "M" && e.amount === 1 + bonus)).toBe(true);
  });
  it("Serenading is unavailable during a block attempt", () => {
    const a = actionSetup("Serenading the Kami", { tha: "superior" });
    announce(a.engine);
    runTrace(a.engine, [["Alice", "pass"], ["Bob", "block:M"]]);
    expect(a.engine.decision()!.options.some((o) => o.id.startsWith("play:Serenading the Kami:"))).toBe(false);
  });
});

describe("Shadow Strike", () => {
  function setup() {
    const a = actionSetup("Shadow Strike", { obt: "superior" });
    a.state.seats[0]!.minions[0]!.strength = 3;
    runTrace(a.engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    return { ...a, cf: combat(a.state) };
  }
  it.each([["basic", 0], ["superior", 1]] as const)("%s commits ranged strength with maneuver and %i press", (mode, press) => {
    const a = setup();
    const dp = walk(a.engine, "combat.range");
    const id = `play:Shadow Strike:${mode}:V1:fix`;
    expect(dp.options.map((o) => o.id)).toContain(id);
    a.engine.choose(id);
    settleCard(a.engine);
    expect(a.cf.strikes.acting).toMatchObject({ name: "Shadow Strike", damage: null, ranged: true, handBonus: 0 });
    expect(a.cf.strikes.acting?.handStrike).not.toBe(true);
    expect(a.cf.maneuverCredits.acting).toBe(1);
    expect(a.cf.presses.acting).toBe(press);
    expect(a.state.seats[0]!.minions[0]!.blood).toBe(4);
    walk(a.engine, "combat.range");
    a.engine.choose("maneuver:credit");
    expect(a.cf.range).toBe("long");
    walk(a.engine, "combat.chooseStrike", "Bob");
    a.engine.choose("strike:hand");
    expect(a.state.eventLog.some((e) => e.type === "DamageInflicted" && e.minion === "M" && e.amount === 3 && !e.aggravated)).toBe(true);
  });
  it("does not consume a hand-only aggravated rider or hand-strike prevention", () => {
    const a = setup();
    a.cf.nextHandOrMeleeStrikeAggravated = { acting: true, opposing: false };
    a.cf.preventHandStrike = { acting: 0, opposing: 3 };
    const dp = walk(a.engine, "combat.chooseStrike");
    a.engine.choose(dp.options.find((o) => o.id === "play:Shadow Strike:basic:V1:fix")!.id);
    settleCard(a.engine);
    a.engine.choose("strike:hand");
    expect(a.cf.nextHandOrMeleeStrikeAggravated.acting).toBe(true);
    const pending = a.cf.pendingDamage.find((p) => p.minion === "M");
    expect(pending).toMatchObject({ amount: 3, aggravated: false });
    expect(pending?.fromHandStrike).not.toBe(true);
    expect(a.cf.preventHandStrike.opposing).toBe(3);
  });
  it("can instead be chosen in the strike step without using its maneuver", () => {
    const a = setup();
    const dp = walk(a.engine, "combat.chooseStrike");
    expect(dp.options.map((o) => o.id)).toContain("play:Shadow Strike:basic:V1:fix");
    a.engine.choose("play:Shadow Strike:basic:V1:fix");
    settleCard(a.engine);
    expect(a.cf.strikes.acting?.ranged).toBe(true);
  });
  it("Earthshock's ranged strength is not a hand strike either", () => {
    const a = setup();
    a.state.seats[0]!.hand.find((c) => c.id === "fix")!.name = "Earthshock";
    a.state.seats[0]!.minions[0]!.disciplines = { pot: "superior" };
    const dp = walk(a.engine, "combat.chooseStrike");
    a.engine.choose(dp.options.find((o) => o.id === "play:Earthshock:basic:V1:fix")!.id);
    settleCard(a.engine);
    expect(a.cf.strikes.acting).toMatchObject({ ranged: true, damage: null });
    expect(a.cf.strikes.acting?.handStrike).not.toBe(true);
  });
  it("is barred by hand-strikes-only in both declaration windows", () => {
    const a = setup();
    a.cf.handStrikesOnly = true;
    expect(walk(a.engine, "combat.range").options.some((o) => o.id.includes("Shadow Strike"))).toBe(false);
    expect(walk(a.engine, "combat.chooseStrike").options.some((o) => o.id.includes("Shadow Strike"))).toBe(false);
  });
});


describe("Shroud of Night", () => {
  it("forbids basic during a bleed but permits superior when stealth is needed", () => {
    const a = actionSetup("Shroud of Night", { obt: "superior" });
    announce(a.engine);
    runTrace(a.engine, [["Alice", "pass"], ["Bob", "block:M"]]);
    const ids = a.engine.decision()!.options.map(o => o.id);
    expect(ids.some(i => i.startsWith("play:Shroud of Night:basic"))).toBe(false);
    expect(ids.some(i => i.startsWith("play:Shroud of Night:superior"))).toBe(true);
  });
  it("permits basic during a non-bleed action", () => {
    const a = actionSetup("Shroud of Night", { obt: "basic" });
    a.state.seats[1]!.minions.find(m => m.id === "M")!.attached.push({ card: { id: "intercept", name: "fixture" }, locked: false, usedThisPhase: false, statics: { intercept: 1 }, tags: [] });
    runTrace(a.engine, [["Alice", "hunt:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"]]);
    expect(a.engine.decision()!.options.some(o => o.id.startsWith("play:Shroud of Night:basic"))).toBe(true);
  });
});

describe("announcement-only effects after an ordinary modifier", () => {
  it("allows Seduction drawn as replacement of the action card", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { disciplines: { dom: "superior" }, blood: 5, capacity: 8 });
    state.seats[0]!.hand = [{ id: "govern", name: "Govern the Unaligned" }];
    state.seats[0]!.library = [{ id: "sed", name: "Seduction" }];
    const engine = new VtesEngine(state, testRegistry);
    engine.choose(engine.decision()!.options.find(o => o.id.startsWith("play:Govern the Unaligned:basic:V1"))!.id);
    for (let i = 0; i < 20 && !(engine.decision()?.seat === "Alice" &&
      engine.decision()?.options.some(o => o.id.startsWith("play:Seduction:"))); i++) engine.choose("pass");
    expect(engine.decision()!.options.some(o => o.id.startsWith("play:Seduction:"))).toBe(true);
  });
  it.each(["Seduction", "The Sleeping Mind"])("%s cannot follow Conditioning", (name) => {
    const a = actionSetup(name, { dom: "superior" });
    a.state.seats[0]!.hand.push({ id: "cond", name: "Conditioning" });
    announce(a.engine);
    expect(a.engine.decision()!.options.some(o => o.id.startsWith(`play:${name}:`))).toBe(true);
    const conditioning = a.engine.decision()!.options.find(o => o.id.startsWith("play:Conditioning:basic"));
    expect(conditioning).toBeDefined();
    a.engine.choose(conditioning!.id);
    settleCard(a.engine);
    expect(a.engine.decision()!.options.some(o => o.id.startsWith(`play:${name}:`))).toBe(false);
  });
  it("allows another announcement-only card after Seduction, including after save/load", () => {
    const a = actionSetup("Seduction", { dom: "superior" });
    a.state.seats[0]!.hand.push({ id: "sleep", name: "The Sleeping Mind" });
    announce(a.engine);
    const seduction = a.engine.decision()!.options.find(o => o.id.startsWith("play:Seduction:superior"));
    expect(seduction).toBeDefined();
    a.engine.choose(seduction!.id);
    settleCard(a.engine);
    const saved = JSON.parse(JSON.stringify(a.state)) as GameState;
    const resumed = new VtesEngine(saved, testRegistry);
    expect(resumed.decision()!.options.some(o => o.id.startsWith("play:The Sleeping Mind:superior"))).toBe(true);
  });
  it("can use Dreams to draw and play Seduction as the action is announced", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { disciplines: { dom: "superior" }, blood: 5 });
    state.seats[0]!.hand = [{ id: "cond", name: "Conditioning" }];
    state.seats[0]!.library = [{ id: "sed", name: "Seduction" }];
    state.seats[0]!.permanents.push({ card: { id: "dreams", name: "Dreams of the Sphinx" },
      locked: false, usedThisPhase: false, tags: [], statics: {}, counters: 0 });
    const engine = new VtesEngine(state, testRegistry);
    announce(engine);
    engine.choose("ability:Dreams of the Sphinx:dreams:hand");
    expect(state.seats[0]!.hand.some(c => c.id === "sed")).toBe(true);
    expect(engine.decision()!.options.some(o => o.id.startsWith("play:Seduction:superior"))).toBe(true);
  });
  it("does not reopen when the ordinary modifier is cancelled", () => {
    const a = actionSetup("Seduction", { dom: "superior" });
    a.state.seats[0]!.hand.push({ id: "cond", name: "Conditioning" });
    a.state.seats[2]!.hand.push({ id: "di", name: "Direct Intervention" });
    announce(a.engine);
    a.engine.choose(a.engine.decision()!.options.find(o => o.id.startsWith("play:Conditioning:basic"))!.id);
    runTrace(a.engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "play:Direct Intervention"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(a.state.eventLog.some(e => e.type === "CardCanceled" && e.name === "Conditioning")).toBe(true);
    expect(a.engine.decision()!.options.some(o => o.id.startsWith("play:Seduction:"))).toBe(false);
  });
  it("also closes announcement-only Club Illusion after an ordinary modifier", () => {
    const a = actionSetup("Seduction", { dom: "superior" });
    a.state.seats[0]!.minions[0]!.sect = "anarch";
    a.state.seats[0]!.permanents.push({ card: { id: "ci", name: "Club Illusion" },
      locked: false, usedThisPhase: false, statics: {}, tags: ["location"] });
    a.state.seats[0]!.hand.push({ id: "cond", name: "Conditioning" });
    announce(a.engine);
    expect(a.engine.decision()!.options.some(o => o.id === "ability:Club Illusion:ci:bleed")).toBe(true);
    a.engine.choose(a.engine.decision()!.options.find(o => o.id.startsWith("play:Conditioning:basic"))!.id);
    settleCard(a.engine);
    expect(a.engine.decision()!.options.some(o => o.id === "ability:Club Illusion:ci:bleed")).toBe(false);
  });
  it("keeps the window closed through save/load", () => {
    const a = actionSetup("Seduction", { dom: "superior" });
    a.state.seats[0]!.hand.push({ id: "cond", name: "Conditioning" });
    announce(a.engine);
    a.engine.choose(a.engine.decision()!.options.find(o => o.id.startsWith("play:Conditioning:basic"))!.id);
    settleCard(a.engine);
    const resumed = new VtesEngine(JSON.parse(JSON.stringify(a.state)) as GameState, testRegistry);
    expect(resumed.decision()!.options.some(o => o.id.startsWith("play:Seduction:"))).toBe(false);
  });
});
