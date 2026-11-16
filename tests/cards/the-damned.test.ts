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

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function setup(v1Capacity: number, withDamnedInHand = true): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  const turn = state.frames[0]!;
  if (turn.kind !== "turn") throw new Error("turn fixture");
  turn.phase = "master";
  turn.masterActionsLeft = 1;
  Object.assign(find(state, "V1"), { blood: 4, capacity: v1Capacity });
  state.seats[0]!.hand = withDamnedInHand ? [{ id: "dmg", name: "The Damned" }] : [];
  return { state, engine: new VtesEngine(state, testRegistry) };
}

/** Pass through every pending frame, declining blocks. */
function settle(state: GameState, engine: VtesEngine): void {
  for (let i = 0; i < 60 && state.frames.some((f) => f.kind === "action" || f.kind === "cardPlay" || f.kind === "blockAttempt"); i++) {
    const dp = engine.decision();
    if (!dp) break;
    engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
  }
}

/** Alice bleeds with V1 (no block is made); return V1's blood change. */
function bleedGain(withDamned: boolean): number {
  const { state, engine } = setup(3, withDamned);
  if (withDamned) engine.choose("play:The Damned:-:V1:dmg");
  // Let the master phase close and pass until the action-phase bleed is offered.
  for (let i = 0; i < 30 && !engine.decision()?.options.some((o) => o.id === "bleed:V1"); i++) {
    const dp = engine.decision();
    if (!dp) break;
    engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
  }
  const before = find(state, "V1").blood;
  if (!engine.decision()?.options.some((o) => o.id === "bleed:V1")) throw new Error("no bleed offered");
  engine.choose("bleed:V1");
  settle(state, engine);
  return find(state, "V1").blood - before;
}

describe("The Damned (100490)", () => {
  it("is put on a vampire with capacity below 5", () => {
    const { engine } = setup(4);
    const opts = engine.decision()!.options.map((o) => o.id);
    expect(opts).toContain("play:The Damned:-:V1:dmg");
  });

  it("is not offered on a vampire with capacity 5 or more", () => {
    const { engine } = setup(5);
    const opts = engine.decision()!.options.map((o) => o.id);
    expect(opts.some((o) => o.startsWith("play:The Damned") && o.includes(":V1:"))).toBe(false);
  });

  it("burns 1 extra blood for each successful bleed by the bearer", () => {
    const plain = bleedGain(false);
    const damned = bleedGain(true);
    expect(damned).toBe(plain - 1);
  });
});
