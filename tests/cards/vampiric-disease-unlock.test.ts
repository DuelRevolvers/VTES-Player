/**
 * Vampiric Disease (102088), end to end through a real turn start: "Each time a
 * vampire with a disease counter unlocks, they burn 1 blood or, if unable, burn
 * the disease counter." The unlock happens in the controller's unlock sweep
 * (the start of their turn), not by calling the engine method directly.
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

/** Carol's turn ends; Alice's turn begins, which runs Alice's unlock sweep. */
function runToAliceTurn(state: GameState, engine: VtesEngine): void {
  const n0 = state.eventLog.length;
  for (let i = 0; i < 60; i++) {
    if (state.eventLog.slice(n0).some((e) => e.type === "TurnBegan" && e.seat === "Alice")) return;
    const dp = engine.decision();
    if (!dp) return;
    engine.choose(dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id);
  }
}

function setup(blood: number, locked: boolean, disease: number) {
  const state = threeSeatGame();
  const turn = state.frames[0]! as any;
  turn.seat = "Carol";
  turn.phase = "discard";
  Object.assign(find(state, "V1"), { blood, locked, counters: { disease } });
  return { state, engine: new VtesEngine(state, testRegistry) };
}

describe("Vampiric Disease (102088), unlock sweep", () => {
  it("a diseased vampire unlocks at its controller's turn start and burns 1 blood; the counter stays", () => {
    const { state, engine } = setup(3, true, 1);
    runToAliceTurn(state, engine);
    const v1 = find(state, "V1");
    expect(v1.locked).toBe(false);
    expect(v1.blood).toBe(2);
    expect(v1.counters?.["disease"]).toBe(1);
  });

  it("with no blood, the diseased vampire still unlocks and burns the counter instead", () => {
    const { state, engine } = setup(0, true, 1);
    runToAliceTurn(state, engine);
    const v1 = find(state, "V1");
    expect(v1.locked).toBe(false);
    expect(v1.blood).toBe(0);
    expect(v1.counters?.["disease"] ?? 0).toBe(0);
  });

  it("NEGATIVE SPACE: an already unlocked diseased vampire is not burned by the sweep", () => {
    const { state, engine } = setup(3, false, 1);
    runToAliceTurn(state, engine);
    expect(find(state, "V1").blood).toBe(3);
    expect(find(state, "V1").counters?.["disease"]).toBe(1);
  });
});
