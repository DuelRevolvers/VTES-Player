/**
 * Vampiric Disease (102088): "If a vampire with a disease counter is in combat at
 * close range with another vampire, the second vampire gets a disease counter
 * before strikes are chosen." Here it is read off a real bleed that Bob blocks:
 * the combat begins, and Bob's blocker M must carry the counter by the first
 * strike step.
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function setup(withDisease: boolean): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { blood: 4, counters: withDisease ? { disease: 1 } : {} });
  const engine = new VtesEngine(state, testRegistry);
  return { state, engine };
}

/** Alice bleeds V1; Bob blocks with M. Stops right after the block is declared. */
function intoCombat(engine: VtesEngine, state: GameState): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"],
  ]);
  // The block resolves over a few windows; stop as soon as the combat exists,
  // before any strike is chosen.
  for (let i = 0; i < 20 && !state.frames.some((f) => f.kind === "combat"); i++) {
    const dp = engine.decision();
    if (!dp) break;
    engine.choose(dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id);
  }
}

describe("Vampiric Disease (102088), combat spread", () => {
  it("a diseased vampire in close-range combat with a vampire gives the other a counter", () => {
    const { state, engine } = setup(true);
    intoCombat(engine, state);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(true);
    expect(find(state, "M").counters?.["disease"] ?? 0).toBe(1);
  });

  it("NEGATIVE SPACE: without a diseased bearer, the blocker gets no counter", () => {
    const { state, engine } = setup(false);
    intoCombat(engine, state);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(true);
    expect(find(state, "M").counters?.["disease"] ?? 0).toBe(0);
  });
});
