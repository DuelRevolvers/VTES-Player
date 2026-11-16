/**
 * Memories of Mortality (101198): "Master. Put this card on a vampire; this
 * vampire cannot attempt to block allies. Any damage this vampire inflicts on
 * allies is reduced to 0. This vampire may burn 1 blood during his or her
 * controller's influence phase to burn this card; he or she then goes into
 * torpor."
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Alice's V1 (blood 4, capacity 3) with Memories in hand; ally A (life 2) for Bob. */
function setup(withMemories: boolean): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  const turn = state.frames[0]!;
  if (turn.kind !== "turn") throw new Error("turn fixture");
  turn.phase = "master";
  turn.masterActionsLeft = 1;
  Object.assign(find(state, "V1"), { blood: 4, capacity: 3 });
  // A Scope gives V1 the intercept a block needs (as in the Cry Wolf test).
  find(state, "V1").attached.push({ card: { id: "scope", name: "Scope" }, locked: false, usedThisPhase: false, statics: { intercept: 3 }, tags: [] });
  state.seats[0]!.hand = withMemories ? [{ id: "mem", name: "Memories of Mortality" }] : [];
  state.seats[1]!.minions.push(makeAlly("A", "Bob", 2));
  return { state, engine: new VtesEngine(state, testRegistry) };
}

/** Pass until the given option is offered (or give up). */
function passUntil(state: GameState, engine: VtesEngine, pred: (ids: string[]) => boolean, max = 80): boolean {
  for (let i = 0; i < max; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    const ids = dp.options.map((o) => o.id);
    if (pred(ids)) return true;
    // Never pick an action by accident: prefer pass, then end.
    engine.choose(ids.includes("pass") ? "pass" : ids.includes("end") ? "end" : ids[0]!);
  }
  void state;
  return false;
}

describe("Memories of Mortality (101198)", () => {
  it("is offered on any vampire, including another Methuselah's", () => {
    const { state, engine } = setup(true);
    find(state, "W").capacity = 3;
    const opts = engine.decision()!.options.map((o) => o.id);
    expect(opts.some((o) => o.startsWith("play:Memories of Mortality") && o.includes(":W:"))).toBe(true);
  });

  it("is put on a vampire and carries the no-ally-blocks and zero-ally-damage statics", () => {
    const { state, engine } = setup(true);
    expect(engine.decision()!.options.map((o) => o.id)).toContain("play:Memories of Mortality:-:V1:mem");
    engine.choose("play:Memories of Mortality:-:V1:mem");
    passUntil(state, engine, (ids) => ids.includes("bleed:V1"));
    const card = find(state, "V1").attached.find((p) => p.card.name === "Memories of Mortality");
    expect(card).toBeDefined();
    expect(card!.statics.cannotBlockKind).toBe("ally");
    expect(card!.statics.allyDamageZeroed).toBe(true);
  });

  it("reduces the bearer's damage to an ally to 0 (control: the ally takes 1)", () => {
    const run = (withMemories: boolean): number => {
      const { state, engine } = setup(withMemories);
      if (withMemories) engine.choose("play:Memories of Mortality:-:V1:mem");
      passUntil(state, engine, (ids) => ids.includes("bleed:V1"));
      engine.choose("bleed:V1");
      // Bob's ally A is not in the way of V1's bleed; let combat run with hand strikes.
      for (let i = 0; i < 120 && state.frames.some((f) => f.kind === "combat" || f.kind === "action" || f.kind === "blockAttempt"); i++) {
        const dp = engine.decision();
        if (!dp) break;
        const ids = dp.options.map((o) => o.id);
        if (ids.includes("block:A")) engine.choose("block:A");
        else if (ids.includes("strike:hand")) engine.choose("strike:hand");
        else engine.choose(ids.includes("pass") ? "pass" : ids.includes("end") ? "end" : ids[0]!);
      }
      return find(state, "A").blood;
    };
    expect(run(false)).toBe(1);
    expect(run(true)).toBe(2);
  });

  it("does not let the bearer block an action taken by an ally (control: it can)", () => {
    const blockOffered = (withMemories: boolean): boolean => {
      const { state, engine } = setup(withMemories);
      // Carol's ally bleeds Alice (Carol's prey), so Alice's V1 is the candidate blocker.
      state.seats[2]!.minions.push(makeAlly("C", "Carol", 2));
      if (withMemories) engine.choose("play:Memories of Mortality:-:V1:mem");
      const ok = passUntil(state, engine, (ids) => ids.some((o) => o === "bleed:C") && engine.decision()!.seat === "Carol", 200);
      if (!ok) throw new Error("Carol's ally bleed not offered");
      engine.choose("bleed:C");
      passUntil(state, engine, (ids) => ids.some((o) => o.startsWith("block:")), 60);
      return engine.decision()?.options.some((o) => o.id === "block:V1") ?? false;
    };
    expect(blockOffered(false)).toBe(true);
    expect(blockOffered(true)).toBe(false);
  });

  it("the bearer may burn 1 blood in the controller's influence phase to burn the card and go to torpor", () => {
    const { state, engine } = setup(true);
    engine.choose("play:Memories of Mortality:-:V1:mem");
    expect(passUntil(state, engine, (ids) => ids.includes("ability:Memories of Mortality:mem:burn"))).toBe(true);
    const before = find(state, "V1").blood;
    engine.choose("ability:Memories of Mortality:mem:burn");
    const v1 = find(state, "V1");
    expect(v1.attached.some((p) => p.card.name === "Memories of Mortality")).toBe(false);
    expect(v1.blood).toBe(before - 1);
    expect(v1.inTorpor).toBe(true);
  });
});
