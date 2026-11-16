/**
 * The Damned (100490): "Unique master. Put this card on a vampire with a
 * capacity below 5. The vampire with this card burns 1 additional blood for
 * each bleeding action he or she successfully performs (after resolving the
 * action)."
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function minion(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function setup(capacity: number, withDamned: boolean): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  const turn = state.frames[0]! as any;
  turn.phase = "master";
  turn.masterActionsLeft = 1;
  Object.assign(minion(state, "V1"), { blood: 4, capacity });
  state.seats[0]!.hand = withDamned ? [{ id: "td", name: "The Damned" }] : [];
  const engine = new VtesEngine(state, testRegistry);
  if (withDamned) engine.choose("play:The Damned:-:V1:td");
  return { state, engine };
}

/** Pass through the turn, bleeding with V1 once when offered. */
function runTo(engine: VtesEngine, state: GameState, phase: string, bleed: boolean): boolean {
  let bled = !bleed;
  for (let i = 0; i < 300; i++) {
    if ((state.frames[0] as any).phase === phase) return true;
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

describe("The Damned (100490)", () => {
  it("a successful bleed burns 1 extra blood", () => {
    const { state, engine } = setup(5 - 1, true);
    expect(runTo(engine, state, "influence", true)).toBe(true);
    const v1 = minion(state, "V1");
    expect(v1.successfulActionThisTurn).toBe(true);
    // bleed itself costs no blood; The Damned burns 1 after the action succeeds
    expect(v1.blood).toBe(3);
  });

  it("no bleeding action, no extra burn", () => {
    const { state, engine } = setup(4, true);
    expect(runTo(engine, state, "influence", false)).toBe(true);
    expect(minion(state, "V1").blood).toBe(4);
  });

  // A FAILED bleed burning nothing is not covered here: forcing a block needs
  // a Bob minion, which this fixture does not have.
  it("a vampire with capacity 5 cannot take the card", () => {
    const state = threeSeatGame();
    const turn = state.frames[0]! as any;
    turn.phase = "master";
    turn.masterActionsLeft = 1;
    Object.assign(minion(state, "V1"), { blood: 4, capacity: 5 });
    state.seats[0]!.hand = [{ id: "td", name: "The Damned" }];
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((o) => o.startsWith("play:The Damned"))).toBe(false);
  });
});
