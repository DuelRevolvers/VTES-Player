import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/engine.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("Kindred Spirits", () => {
  it("offers prey and predator, never self, and resolves a bleed against the chosen Methuselah", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { disciplines: { dem: "superior" }, blood: 5 });
    state.seats[0]!.hand.push({ id: "ks", name: "Kindred Spirits" });
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine.decision()!.options.map(o => o.id);
    for (const mode of ["basic", "superior"]) {
      expect(ids).toContain(`play:Kindred Spirits:${mode}:V1:Bob:ks`);
      expect(ids).toContain(`play:Kindred Spirits:${mode}:V1:Carol:ks`);
      expect(ids).not.toContain(`play:Kindred Spirits:${mode}:V1:Alice:ks`);
    }
    const alice = state.seats[0]!.pool, bob = state.seats[1]!.pool, carol = state.seats[2]!.pool;
    engine.choose("play:Kindred Spirits:superior:V1:Carol:ks");
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    const af = state.frames.find(f => f.kind === "action");
    expect(af?.kind === "action" && af.target).toBe("Carol");
    for (let i = 0; i < 30 && !state.eventLog.some(e => e.type === "ActionResolved"); i++) {
      const dp = engine.decision()!;
      engine.choose((dp.options.find(o => o.id === "pass") ?? dp.options[0]!).id);
    }
    expect(state.seats[2]!.pool).toBe(carol - 2);
    expect(state.seats[1]!.pool).toBe(bob);
    expect(state.seats[0]!.pool).toBe(alice + 1);
    expect(state.seats[0]!.minions[0]!.bledThisTurn).toBe(true);
  });
  it("uses the selected target for bleed restrictions and announcement costs", () => {
    const state = threeSeatGame();
    const v = state.seats[0]!.minions[0]!;
    Object.assign(v, { disciplines: { dem: "basic" }, blood: 1 });
    v.attached.push({ card: { id: "tv", name: "test" }, controller: "Bob", locked: false, usedThisPhase: false, tags: [], statics: { bleedAgainstControllerBloodTax: 2 } });
    state.seats[0]!.hand.push({ id: "ks", name: "Kindred Spirits" });
    const ids = new VtesEngine(state, testRegistry).decision()!.options.map(o => o.id);
    expect(ids).not.toContain("play:Kindred Spirits:basic:V1:Bob:ks");
    expect(ids).toContain("play:Kindred Spirits:basic:V1:Carol:ks");
  });
  it("prices and collects the target-dependent tax only for the selected victim", () => {
    for (const [victim, price] of [["Bob", 2], ["Carol", 0]] as const) {
      const state = threeSeatGame();
      const v = state.seats[0]!.minions[0]!;
      Object.assign(v, { disciplines: { dem: "basic" }, blood: 5 });
      v.attached.push({ card: { id: "tv", name: "test" }, controller: "Bob", locked: false, usedThisPhase: false, tags: [], statics: { bleedAgainstControllerBloodTax: 2 } });
      state.seats[0]!.hand.push({ id: "ks", name: "Kindred Spirits" });
      const engine = new VtesEngine(state, testRegistry);
      const id = `play:Kindred Spirits:basic:V1:${victim}:ks`;
      const option = engine.decision()!.options.find(o => o.id === id);
      expect(option?.kind === "playCard" && option.cost?.blood).toBe(price);
      engine.choose(id);
      runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
      expect(v.blood).toBe(5 - price);
      const action = state.frames.find(f => f.kind === "action");
      expect(action?.kind === "action" && action.target).toBe(victim);
    }
  });

});
