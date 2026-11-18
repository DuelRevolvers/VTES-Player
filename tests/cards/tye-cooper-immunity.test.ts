/**
 * Tye Cooper (102053): "He is immune to non-aggravated damage." Aggravated
 * damage still lands. The burn action and the ash-heap rider are not
 * modelled yet; see docs/card-audit/manual-findings.json.
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Bob's Tye Cooper (ally, 3 blood) next to a plain ally of the same size. */
function setup(): VtesEngine {
  const state = threeSeatGame();
  state.seats[1]!.minions.push(makeMinion("TC", "Bob", { kind: "ally", name: "Tye Cooper", blood: 3 }));
  state.seats[1]!.minions.push(makeMinion("PL", "Bob", { kind: "ally", name: "Plain Ally", blood: 3 }));
  return new VtesEngine(state, testRegistry);
}

function hit(engine: VtesEngine, minion: string, amount: number, aggravated: boolean): void {
  (engine as unknown as {
    applyResolvedDamage(pd: { minion: string; amount: number; source: string | null; aggravated: boolean }): void;
  }).applyResolvedDamage({ minion, amount, source: null, aggravated });
}

describe("Tye Cooper (102053) immunity", () => {
  it("takes no harm from non-aggravated damage", () => {
    const engine = setup();
    hit(engine, "TC", 2, false);
    expect(find(engine.state, "TC").blood).toBe(3);
  });

  it("aggravated damage still lands", () => {
    const engine = setup();
    hit(engine, "TC", 2, true);
    expect(find(engine.state, "TC").blood).toBe(1);
  });

  it("NEGATIVE SPACE: an ordinary ally with the same blood takes the damage", () => {
    const engine = setup();
    hit(engine, "PL", 2, false);
    expect(find(engine.state, "PL").blood).toBe(1);
  });
});
