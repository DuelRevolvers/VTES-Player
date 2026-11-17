/**
 * Agent of Power (100025): "Master: Discipline. Trifle. Unique. Put this card
 * on a vampire you control and choose a Discipline. This vampire gains 1 level
 * of that Discipline. Burn this card during your discard phase."
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, disciplinesOf } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function setup(): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  const turn = state.frames[0]!;
  if (turn.kind !== "turn") throw new Error("turn fixture");
  turn.phase = "master";
  turn.masterActionsLeft = 1;
  Object.assign(find(state, "V1"), { blood: 4, capacity: 5 });
  state.seats[0]!.hand = [{ id: "ap", name: "Agent of Power" }];
  return { state, engine: new VtesEngine(state, testRegistry) };
}

function passUntil(engine: VtesEngine, pred: (ids: string[]) => boolean, max = 120): boolean {
  for (let i = 0; i < max; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    const ids = dp.options.map((o) => o.id);
    if (pred(ids)) return true;
    engine.choose(ids.includes("pass") ? "pass" : ids.includes("end") ? "end" : ids[0]!);
  }
  return false;
}

describe("Agent of Power (100025)", () => {
  it("is put only on a vampire its controller controls, with a chosen Discipline", () => {
    const { engine } = setup();
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids).toContain("play:Agent of Power:-:V1:ap:ani");
    expect(ids.some((o) => o.startsWith("play:Agent of Power") && o.includes(":W:"))).toBe(false);
  });

  it("gives the vampire one level of the chosen Discipline", () => {
    const { state, engine } = setup();
    engine.choose("play:Agent of Power:-:V1:ap:ani");
    expect(passUntil(engine, (ids) => ids.includes("bleed:V1"))).toBe(true);
    const v1 = find(state, "V1");
    expect(disciplinesOf(v1).ani).toBe("basic");
    const card = v1.attached.find((p) => p.card.name === "Agent of Power");
    expect(card?.tags).toContain("discipline");
  });

  it("is burned during its controller's discard phase", () => {
    const { state, engine } = setup();
    engine.choose("play:Agent of Power:-:V1:ap:ani");
    expect(passUntil(engine, (ids) => ids.includes("bleed:V1"))).toBe(true);
    expect(passUntil(engine, (ids) => ids.includes("ability:Agent of Power:ap:burn"))).toBe(true);
    engine.choose("ability:Agent of Power:ap:burn");
    expect(find(state, "V1").attached.some((p) => p.card.name === "Agent of Power")).toBe(false);
  });
});
