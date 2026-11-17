/**
 * Spontaneous Power (101855): "Unique master. Put this card on a vampire and
 * choose a Discipline. This vampire gains 1 level of the chosen Discipline.
 * While in play, this card counts as a master: Discipline card."
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
  state.seats[0]!.hand = [{ id: "sp", name: "Spontaneous Power" }];
  return { state, engine: new VtesEngine(state, testRegistry) };
}

/** Pass until the given option is offered, never choosing an action by accident. */
function passUntil(engine: VtesEngine, pred: (ids: string[]) => boolean, max = 80): boolean {
  for (let i = 0; i < max; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    const ids = dp.options.map((o) => o.id);
    if (pred(ids)) return true;
    engine.choose(ids.includes("pass") ? "pass" : ids.includes("end") ? "end" : ids[0]!);
  }
  return false;
}

describe("Spontaneous Power (101855)", () => {
  it("offers each vampire with each Discipline, but not a Discipline the vampire has at superior", () => {
    const { state, engine } = setup();
    find(state, "V1").disciplines = { dom: "basic", aus: "superior" };
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids).toContain("play:Spontaneous Power:-:V1:sp:ani");
    expect(ids).toContain("play:Spontaneous Power:-:V1:sp:dom");
    expect(ids).not.toContain("play:Spontaneous Power:-:V1:sp:aus");
  });

  it("can be put on another Methuselah's vampire", () => {
    const { engine } = setup();
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((o) => o.startsWith("play:Spontaneous Power") && o.includes(":W:") && o.endsWith(":pre"))).toBe(true);
  });

  it("gives the chosen Discipline one level and counts as a Discipline master", () => {
    const { state, engine } = setup();
    expect(disciplinesOf(find(state, "V1")).ani).toBeUndefined();
    engine.choose("play:Spontaneous Power:-:V1:sp:ani");
    expect(passUntil(engine, (ids) => ids.includes("bleed:V1"))).toBe(true);
    const v1 = find(state, "V1");
    expect(disciplinesOf(v1).ani).toBe("basic");
    const card = v1.attached.find((p) => p.card.name === "Spontaneous Power");
    expect(card).toBeDefined();
    expect(card!.tags).toContain("discipline");
  });

  it("a Discipline already at basic goes to superior", () => {
    const { state, engine } = setup();
    find(state, "V1").disciplines = { dom: "basic" };
    engine.choose("play:Spontaneous Power:-:V1:sp:dom");
    expect(passUntil(engine, (ids) => ids.includes("bleed:V1"))).toBe(true);
    expect(disciplinesOf(find(state, "V1")).dom).toBe("superior");
  });
});
