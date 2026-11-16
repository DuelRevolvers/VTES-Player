/**
 * Loner (101121): "Master: archetype. Put this card on a vampire you control.
 * During your influence phase, if this vampire successfully performed an action
 * this turn and none of your other minions attempted any actions this turn, he
 * or she gains 1 blood from the blood bank, if he or she is ready."
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function minion(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function setup(withLoner: boolean): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  const turn = state.frames[0]! as any;
  turn.phase = "master";
  turn.masterActionsLeft = 1;
  Object.assign(minion(state, "V1"), { blood: 4, capacity: 5 });
  state.seats[0]!.hand = withLoner ? [{ id: "lo", name: "Loner" }] : [];
  const engine = new VtesEngine(state, testRegistry);
  if (withLoner) engine.choose("play:Loner:-:V1:lo");
  return { state, engine };
}

/** Pass through the turn, performing one bleed by V1 when offered. Stops at
 *  `phase`. Never picks a block or other decision by accident. */
function runTo(engine: VtesEngine, state: GameState, phase: string, bleedFirst = true): boolean {
  let bled = !bleedFirst;
  for (let i = 0; i < 300; i++) {
    const turn = state.frames[0] as any;
    if (turn.phase === phase) return true;
    const dp = engine.decision();
    if (!dp) return false;
    const ids = dp.options.map((o) => o.id);
    if (!bled && ids.includes("bleed:V1")) {
      bled = true;
      engine.choose("bleed:V1");
      continue;
    }
    engine.choose(ids.includes("pass") ? "pass" : ids.includes("end") ? "end" : ids[0]!);
  }
  return false;
}

describe("Loner (101121)", () => {
  it("control: the same turn without Loner gains no blood at the influence phase", () => {
    const { state, engine } = setup(false);
    expect(runTo(engine, state, "influence")).toBe(true);
    expect(minion(state, "V1").bledThisTurn).toBe(true); // the action happened
    expect(minion(state, "V1").successfulActionThisTurn).toBe(true);
    expect(minion(state, "V1").blood).toBe(4); // no Loner, no gain
  });

  it("gains 1 blood from the bank at the influence phase after a successful action", () => {
    const { state, engine } = setup(true);
    expect(runTo(engine, state, "influence")).toBe(true);
    expect(minion(state, "V1").successfulActionThisTurn).toBe(true);
    expect(minion(state, "V1").blood).toBe(5);
  });

  it("gains nothing when another of its controller's minions attempted an action", () => {
    const { state, engine } = setup(true);
    // A second Alice minion that has tried an action this turn (its own
    // announcement sets this flag; the test sets it directly).
    state.seats[0]!.minions.push(makeMinion("V9", "Alice", { disciplines: { dom: "basic" } }));
    minion(state, "V9").attemptedActionThisTurn = true;
    expect(runTo(engine, state, "influence")).toBe(true);
    expect(minion(state, "V1").successfulActionThisTurn).toBe(true);
    expect(minion(state, "V1").blood).toBe(4);
  });

  it("gains nothing when the vampire is in torpor (not ready)", () => {
    const { state, engine } = setup(true);
    let torporSet = false;
    for (let i = 0; i < 300 && !torporSet; i++) {
      if (minion(state, "V1").successfulActionThisTurn) {
        minion(state, "V1").inTorpor = true;
        torporSet = true;
        break;
      }
      const dp = engine.decision();
      if (!dp) break;
      const ids = dp.options.map((o) => o.id);
      if (ids.includes("bleed:V1")) engine.choose("bleed:V1");
      else engine.choose(ids.includes("pass") ? "pass" : ids.includes("end") ? "end" : ids[0]!);
    }
    expect(torporSet).toBe(true);
    expect(runTo(engine, state, "influence", false)).toBe(true);
    expect(minion(state, "V1").blood).toBe(4);
  });

  it("gains nothing without a successful action this turn", () => {
    const { state, engine } = setup(true);
    expect(runTo(engine, state, "influence", false)).toBe(true);
    expect(minion(state, "V1").successfulActionThisTurn).toBeFalsy();
    expect(minion(state, "V1").blood).toBe(4);
  });
});
