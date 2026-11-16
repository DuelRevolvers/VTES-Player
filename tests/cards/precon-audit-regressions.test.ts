import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/engine.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("Lost in Crowds and Into Thin Air", () => {
  for (const [first, second] of [["Lost in Crowds", "Into Thin Air"], ["Into Thin Air", "Lost in Crowds"]] as const) {
    it(`cannot play ${second} after ${first}, even when stealth is needed again`, () => {
      const state = threeSeatGame();
      state.seats[0]!.minions[0]!.disciplines = { obf: "superior" };
      state.seats[0]!.hand.push({ id: "first", name: first }, { id: "second", name: second });
      const w = state.seats[1]!.minions.find((m) => m.id === "W")!;
      Object.assign(w, { title: "baron", sect: "anarch", locked: true });
      state.seats[1]!.minions.find((m) => m.id === "M")!.sect = "anarch";
      state.seats[1]!.hand.push({ id: "or1", name: "Organized Resistance" });
      const engine = new VtesEngine(state, testRegistry);
      runTrace(engine, [
        ["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
        ["Alice", "pass"], ["Bob", "block:M"],
      ]);
      const initial = engine.decision()!.options;
      expect(initial.some((o) => o.id.startsWith(`play:${second}:basic`))).toBe(true);
      if (first === "Into Thin Air") expect(initial.some((o) => o.id.startsWith("play:Into Thin Air:superior"))).toBe(true);
      runTrace(engine, [
        ["Alice", `play:${first}:basic`], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
        ["Alice", "pass"], ["Bob", "play:Organized Resistance:basic:W:intercept:M"],
        ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ]);
      expect(engine.decision()!.seat).toBe("Alice");
      expect(engine.decision()!.options.some((o) => o.id.startsWith(`play:${second}`))).toBe(false);
      if (first === "Into Thin Air") expect(state.seats[0]!.delayedDraws).toBe(1);
    });
  }
  it("a cancelled modifier was still played and bars its counterpart", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.disciplines = { obf: "basic" };
    state.seats[0]!.hand.push({ id: "first", name: "Lost in Crowds" }, { id: "second", name: "Into Thin Air" });
    state.seats[2]!.hand.push({ id: "di", name: "Direct Intervention" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "play:Lost in Crowds:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "play:Direct Intervention"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(state.eventLog.some((e) => e.type === "CardCanceled" && e.name === "Lost in Crowds")).toBe(true);
    expect(engine.decision()!.seat).toBe("Alice");
    expect(engine.decision()!.options.some((o) => o.id.startsWith("play:Into Thin Air"))).toBe(false);
  });
});

describe("Terrifying Visage", () => {
  it("targets any ready Cathari vampire, including another player's, but not torpor or a duplicate", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("fixture");
    tf.phase = "master";
    tf.masterActionsLeft = 1;
    state.seats[0]!.hand.push({ id: "tv", name: "Terrifying Visage" });
    const w = state.seats[1]!.minions.find((m) => m.id === "W")!;
    const m = state.seats[1]!.minions.find((m) => m.id === "M")!;
    w.path = "Cathari";
    m.path = "Cathari";
    m.inTorpor = true;
    const engine = new VtesEngine(state, testRegistry);
    let options = engine.decision()!.options.filter((o) => o.kind === "playCard" && o.name === "Terrifying Visage");
    expect(options.some((o) => o.kind === "playCard" && o.params["target"] === "W")).toBe(true);
    expect(options.some((o) => o.kind === "playCard" && o.params["target"] === "M")).toBe(false);
    w.attached.push({ card: { id: "old", name: "Terrifying Visage" }, locked: false, usedThisPhase: false, statics: {}, tags: ["Terrifying Visage"] });
    options = engine.decision()!.options.filter((o) => o.kind === "playCard" && o.name === "Terrifying Visage");
    expect(options.some((o) => o.kind === "playCard" && o.params["target"] === "W")).toBe(false);
  });
});

describe("Wolf Claws", () => {
  it("superior can cancel an opposing press to continue", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { blood: 5, capacity: 8, disciplines: { pro: "superior" } });
    state.seats[0]!.hand.push({ id: "wc", name: "Wolf Claws" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    const cf = state.frames.find((f) => f.kind === "combat");
    if (!cf || cf.kind !== "combat") throw new Error("fixture");
    for (let i = 0; i < 25; i++) {
      const dp = engine.decision()!;
      if (dp.window === "combat.press" && dp.seat === "Alice") break;
      const opt = dp.options.find((o) => o.id === "pass") ?? dp.options.find((o) => o.id === "strike:hand");
      if (!opt) throw new Error(`cannot advance ${dp.window}`);
      engine.choose(opt.id);
    }
    cf.willContinue = true;
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.press");
    const cancel = dp.options.find((o) => o.id.startsWith("play:Wolf Claws:superior") && o.id.includes("cancel"));
    expect(cancel).toBeDefined();
    engine.choose(cancel!.id);
    for (let i = 0; i < 3; i++) engine.choose("pass");
    expect(cf.willContinue).toBe(false);
  });
});
