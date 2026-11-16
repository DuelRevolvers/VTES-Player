/**
 * Revelation of the Serpent (102233) — superior: +1 bleed, and on a
 * successful bleed burn 2 of your corruption from a minion of the target to
 * unlock the acting vampire.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("Revelation of the Serpent (102233)", () => {
  it("superior: +1 bleed, then burns 2 corruption to unlock the vampire", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pre: "superior", pro: "superior" };
    v1.blood = 3;
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.corruption = { Alice: 2 };
    state.seats[0]!.hand.push({ id: "rs1", name: "Revelation of the Serpent" });
    const bobStart = state.seats[1]!.pool;
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "play:Revelation of the Serpent:superior:V1:bleed"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // its as-played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // effects
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // resolve
    ]);

    expect(state.seats[1]!.pool).toBe(bobStart - 2); // base 1 + 1
    expect(engine.decision()!.window).toBe("choice");
    engine.choose("choice:Revelation of the Serpent:rs1:corruptionUnlock:M");
    expect(state.seats[1]!.minions.find((x) => x.id === "M")!.corruption?.["Alice"]).toBe(0);
    expect(state.seats[0]!.minions[0]!.locked).toBe(false); // unlocked
  });
  it("lets the player decline or choose which target's counters to burn", () => {
    function game() {
      const state = threeSeatGame();
      const v = state.seats[0]!.minions[0]!;
      Object.assign(v, { blood: 3, disciplines: { pre: "superior", pro: "superior" } });
      for (const m of state.seats[1]!.minions) m.corruption = { Alice: 2, Carol: 3 };
      state.seats[0]!.hand.push({ id: "rs1", name: "Revelation of the Serpent" });
      const engine = new VtesEngine(state, testRegistry);
      runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
        ["Alice", "play:Revelation of the Serpent:superior:V1:bleed"],
        ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
        ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
      return { state, engine, v };
    }
    const a = game();
    expect(a.engine.decision()!.options.map(o => o.id)).toEqual(expect.arrayContaining([
      "choice:Revelation of the Serpent:rs1:corruptionUnlock:M",
      "choice:Revelation of the Serpent:rs1:corruptionUnlock:W", "pass",
    ]));
    a.engine.choose("pass");
    expect(a.v.locked).toBe(true);
    expect(a.state.seats[1]!.minions.every(m => m.corruption?.Alice === 2)).toBe(true);
    const b = game();
    const copy = JSON.parse(JSON.stringify(b.state));
    const resumed = new VtesEngine(copy, testRegistry);
    resumed.choose("choice:Revelation of the Serpent:rs1:corruptionUnlock:W");
    expect(copy.seats[0].minions[0].locked).toBe(false);
    expect(copy.seats[1].minions.find((m: { id: string }) => m.id === "W").corruption).toEqual({ Alice: 0, Carol: 3 });
    expect(copy.seats[1].minions.find((m: { id: string }) => m.id === "M").corruption.Alice).toBe(2);
  });

});

describe("Revelation and The Sleeping Mind", () => {
  it("does not offer to burn corruption to unlock when superior Sleeping Mind forbids it", () => {
    const state = threeSeatGame();
    const actor = state.seats[0]!.minions[0]!;
    Object.assign(actor, { blood: 4, disciplines: { dom: "superior", pre: "superior", pro: "superior" } });
    const target = state.seats[1]!.minions.find(m => m.id === "M")!;
    target.corruption = { Alice: 2 };
    state.seats[0]!.hand.push({ id: "sm", name: "The Sleeping Mind" }, { id: "rs", name: "Revelation of the Serpent" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "play:The Sleeping Mind:superior:V1:sm"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "play:Revelation of the Serpent:superior:V1:bleed:rs"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    for (let i = 0; i < 12 && state.frames.some(f => f.kind === "action"); i++) {
      const dp = engine.decision()!;
      expect(dp.window).not.toBe("choice");
      engine.choose("pass");
    }
    expect(actor.locked).toBe(true);
    expect(target.corruption?.Alice).toBe(2);
    expect(state.seats[1]!.pool).toBe(8);
  });
});

describe("Revelation: oust before its unlock choice", () => {
  function lethal(rescue: boolean) {
    const state = threeSeatGame();
    const actor = state.seats[0]!.minions[0]!;
    Object.assign(actor, { blood: 4, disciplines: { pre: "superior", pro: "superior" } });
    const target = state.seats[1]!.minions.find(m => m.id === "M")!;
    target.corruption = { Alice: 2 };
    state.seats[1]!.pool = 2;
    state.seats[0]!.hand.push({ id: "rs", name: "Revelation of the Serpent" });
    if (rescue) state.seats[2]!.hand.push({ id: "lb", name: "Life Boon" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "play:Revelation of the Serpent:superior:V1:bleed:rs"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    return { state, engine, actor };
  }
  it("does not unlock using counters on an ousted target", () => {
    const { state, engine, actor } = lethal(false);
    expect(state.seats[1]!.ousted).toBe(true);
    expect(actor.locked).toBe(true);
    expect(engine.decision()?.options.some(o => o.id.includes(":corruptionUnlock:")) ?? false).toBe(false);
    expect(state.eventLog.some(e => e.type === "CorruptionChanged" && e.delta === -2)).toBe(false);
  });
  it("offers unlock after a Life Boon saves the target, including after save/load", () => {
    const { state, engine } = lethal(true);
    expect(engine.decision()!.window).toBe("oust");
    const copy = JSON.parse(JSON.stringify(state));
    const resumed = new VtesEngine(copy, testRegistry);
    resumed.choose("play:Life Boon:-:Bob:lb");
    for (let i = 0; i < 10 && resumed.decision()!.window === "card.asPlayed"; i++) resumed.choose("pass");
    resumed.choose("choice:Life Boon:lb:amount:2");
    for (let i = 0; i < 20 && resumed.decision()!.window !== "choice"; i++) resumed.choose("pass");
    expect(copy.seats[1].ousted).toBe(false);
    expect(resumed.decision()!.options.some(o => o.id === "choice:Revelation of the Serpent:rs:corruptionUnlock:M")).toBe(true);
    resumed.choose("choice:Revelation of the Serpent:rs:corruptionUnlock:M");
    expect(copy.seats[0].minions[0].locked).toBe(false);
  });
});
