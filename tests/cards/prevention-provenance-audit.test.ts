import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/engine.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function game(name: string, helper = false) {
  const state = threeSeatGame();
  Object.assign(state.seats[0]!.minions[0]!, { blood: 6, capacity: 8, clan: "Salubri", disciplines: { tha: "superior", for: "superior" } });
  Object.assign(state.seats[1]!.minions.find((m) => m.id === "M")!, { blood: 6, strength: 3 });
  if (helper) {
    const m = makeMinion("helper", "Alice", { blood: 5, disciplines: { for: "superior" } });
    m.clan = "Salubri";
    state.seats[0]!.minions.push(m);
  }
  state.seats[0]!.hand.push({ id: "card", name });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "strike:hand"], ["Bob", "strike:hand"],
  ]);
  const cf = state.frames.find((f) => f.kind === "combat");
  if (!cf || cf.kind !== "combat") throw new Error("no combat");
  return { state, engine, cf };
}

describe("prevention from an opposing strike", () => {
  it.each([
    ["Rego Motum", "basic"], ["Rego Motum", "superior"],
    ["Rolling with the Punches", "superior"], ["Touch of Valeren", "basic"], ["Skin of Steel", "superior"],
  ])("%s %s requires a genuine opposing strike", (name, mode) => {
    const { engine, cf } = game(name);
    const prefix = `play:${name}:${mode}`;
    const offered = () => engine.decision()!.options.some((o) => o.id.startsWith(prefix));
    const pd = cf.pendingDamage[0]!;
    expect(pd.fromStrike).toBe(true);
    expect(offered()).toBe(true);
    pd.fromStrike = false;
    expect(offered()).toBe(false);
    pd.fromStrike = true;
    pd.source = "V1";
    expect(offered()).toBe(false);
  });

  it("all-damage prevention covers multiple packets of the same strike, not environmental damage", () => {
    const { engine, cf } = game("Touch of Valeren");
    const pd = cf.pendingDamage[0]!;
    cf.pendingDamage.push({ ...pd, amount: 2, aggravated: true });
    cf.pendingDamage.push({ ...pd, amount: 1, source: null, fromStrike: false });
    const opt = engine.decision()!.options.find((o) => o.id.startsWith("play:Touch of Valeren:basic"));
    expect(opt).toBeDefined();
    engine.choose(opt!.id);
    for (let i = 0; i < 3; i++) engine.choose("pass");
    expect(cf.pendingDamage.some((p) => p.minion === "V1" && p.fromStrike)).toBe(false);
    expect(cf.pendingDamage.some((p) => p.minion === "V1" && !p.fromStrike)).toBe(true);
  });
  it("superior Touch is available to an outside Salubri only for an opposing strike", () => {
    const { engine, cf } = game("Touch of Valeren", true);
    const offered = () => engine.decision()!.options.some((o) => o.id.includes("Touch of Valeren:superior:helper"));
    expect(offered()).toBe(true);
    cf.pendingDamage[0]!.fromStrike = false;
    expect(offered()).toBe(false);
    cf.pendingDamage[0]!.fromStrike = true;
    cf.pendingDamage[0]!.source = "V1";
    expect(offered()).toBe(false);
  });

  it("round shield preserves environmental, unpreventable and discipline-restricted packets", () => {
    const { engine, cf } = game("Rolling with the Punches");
    const original = { ...cf.pendingDamage[0]! };
    const option = engine.decision()!.options.find((o) => o.id.startsWith("play:Rolling with the Punches:superior"))!;
    engine.choose(option.id);
    for (let i = 0; i < 3; i++) engine.choose("pass");
    expect(cf.pendingDamage.some((p) => p.minion === "V1" && p.fromStrike)).toBe(false);
    // Exercise the same entry point used for later strike and non-strike damage.
    engine["pushPendingDamage"](cf, { ...original, amount: 2 });
    expect(cf.pendingDamage.some((p) => p.minion === "V1")).toBe(false);
    engine["pushPendingDamage"](cf, { ...original, amount: 3, fromStrike: false });
    engine["pushPendingDamage"](cf, { ...original, amount: 4, unpreventable: true });
    engine["pushPendingDamage"](cf, { ...original, amount: 5, noPreventBy: ["for"] });
    expect(cf.pendingDamage.filter((p) => p.minion === "V1").map((p) => p.amount)).toEqual([3, 4, 5]);
  });

  it("new strike provenance survives JSON save and reload", () => {
    const { state } = game("Rego Motum");
    const copy = JSON.parse(JSON.stringify(state));
    const engine = new VtesEngine(copy, testRegistry);
    expect(engine.decision()!.options.some((o) => o.id.startsWith("play:Rego Motum:basic"))).toBe(true);
  });

  it("recognizes unambiguous strike packets from older saves, not environmental packets", () => {
    const { state } = game("Rego Motum");
    const copy = JSON.parse(JSON.stringify(state));
    const cf = copy.frames.find((f: { kind: string }) => f.kind === "combat");
    delete cf.pendingDamage[0].fromStrike;
    cf.pendingDamage.push({ ...cf.pendingDamage[0], source: null });
    const engine = new VtesEngine(copy, testRegistry);
    expect(cf.pendingDamage[0].fromStrike).toBe(true);
    expect(cf.pendingDamage.at(-1).fromStrike).toBeUndefined();
    expect(engine.decision()!.options.some((o) => o.id.startsWith("play:Rego Motum:basic"))).toBe(true);
  });

});

describe("Leather Jacket opposing strike prevention", () => {
  it("prevents every packet of the same strike, but not non-strike damage", () => {
    const { state, engine, cf } = game("Rego Motum");
    state.seats[0]!.minions[0]!.attached.push({ card: { id: "jacket", name: "Leather Jacket" }, locked: false, usedThisPhase: false, tags: ["equipment"], statics: {} });
    const pd = cf.pendingDamage[0]!;
    cf.pendingDamage.push({ ...pd, amount: 2, aggravated: true });
    cf.pendingDamage.push({ ...pd, amount: 1, fromStrike: false });
    expect(engine.decision()!.options.some(o => o.id === "ability:Leather Jacket:jacket:burnpreventstrike")).toBe(true);
    engine.choose("ability:Leather Jacket:jacket:burnpreventstrike");
    expect(cf.pendingDamage.filter(p => p.minion === "V1" && p.fromStrike)).toHaveLength(0);
    expect(cf.pendingDamage.filter(p => p.minion === "V1" && !p.fromStrike)).toHaveLength(1);
    expect(state.seats[0]!.minions[0]!.attached.some(p => p.card.id === "jacket")).toBe(false);
  });
  it("does not offer prevention against damage from another effect by the opponent", () => {
    const { state, engine, cf } = game("Rego Motum");
    state.seats[0]!.minions[0]!.attached.push({ card: { id: "jacket", name: "Leather Jacket" }, locked: false, usedThisPhase: false, tags: ["equipment"], statics: {} });
    cf.pendingDamage[0]!.fromStrike = false;
    expect(engine.decision()!.options.some(o => o.id === "ability:Leather Jacket:jacket:burnpreventstrike")).toBe(false);
  });
});
