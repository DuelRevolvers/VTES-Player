/**
 * Inceptor (100969): "Put this card on a vampire of capacity 1". The attach
 * gate is read off the real spec (`cardSpecs`) through `attachTargets`, the
 * same function the play path uses to list legal bearers. The placement
 * itself is tested in inceptor.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { cardSpecs } from "../../src/cards/effects/cards.ts";
import { attachTargets } from "../../src/cards/effects/compile.ts";
import { threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

const inceptorSpec = cardSpecs.find((s) => s.name === "Inceptor")!;

describe("Inceptor attach gate (100969)", () => {
  it("only a capacity-1 vampire is a legal bearer", () => {
    const state = threeSeatGame();
    for (const m of state.seats.flatMap((s) => s.minions)) m.capacity = 3;
    find(state, "V1").capacity = 1;
    const ids = attachTargets(state, "Alice", inceptorSpec).map((m) => m.id);
    expect(ids).toContain("V1");
    // Every other vampire has capacity 3 and must be refused.
    for (const m of state.seats.flatMap((s) => s.minions)) {
      if (m.id !== "V1" && m.kind === "vampire") expect(ids).not.toContain(m.id);
    }
  });

  it("a capacity-2 vampire is refused", () => {
    const state = threeSeatGame();
    for (const m of state.seats.flatMap((s) => s.minions)) m.capacity = 2;
    expect(attachTargets(state, "Alice", inceptorSpec)).toHaveLength(0);
  });
});
