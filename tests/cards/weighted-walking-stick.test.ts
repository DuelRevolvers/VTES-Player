/**
 * Weighted Walking Stick (102169) — a combat card that becomes a weapon
 * on its own player mid-combat, and spends a counter per point of damage
 * its strike inflicts (docs/counter-sinks-design.md).
 *
 *   Only usable before range is determined during the first round. Put
 *   this card with 5 counters on it on this minion; it becomes a melee
 *   weapon equipment that can strike: strength+1 damage. For each damage
 *   inflicted by this strike (even if prevented), burn 1 counter from
 *   this card. Burn this card if it has no counters. A minion can have
 *   only one Weighted Walking Stick.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** V1 (Alice, acting) bleeds Bob; M (Bob) blocks → combat, at Before Range. */
function enterCombat(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"],
    ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
}

function game(): GameState {
  const state = threeSeatGame();
  state.seats[0]!.minions[0]!.blood = 4;
  state.seats[1]!.minions.find((m) => m.id === "M")!.blood = 4;
  state.seats[0]!.hand.push({ id: "ws", name: "Weighted Walking Stick" });
  return state;
}

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function stick(state: GameState) {
  return find(state, "V1").attached.find((p) => p.card.id === "ws");
}

describe("Weighted Walking Stick (102169)", () => {
  it("goes on its own minion with 5 counters before range, in the first round", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ["Alice", "play:Weighted Walking Stick:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);

    const entry = stick(state)!;
    expect(entry.counters).toBe(5);
    expect(entry.tags).toContain("weapon");
    expect(entry.tags).toContain("melee");
  });

  it("strikes for strength+1 and burns a counter per damage inflicted", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ["Alice", "play:Weighted Walking Stick:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // rest of before range
      ["Alice", "pass"], ["Bob", "pass"], // range → close
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "ability:Weighted Walking Stick:ws:strike"],
      ["Bob", "strike:hand"],
      // Damage resolution: the acting minion's damage first (p. 29).
      ["Alice", "pass"], ["Bob", "pass"],
    ]);

    // Strength 1 + 1 = 2 damage on M, so 2 counters go.
    expect(find(state, "M").blood).toBe(2);
    expect(stick(state)?.counters).toBe(3);
  });

  it("is not on offer once its bearer already has one", () => {
    const state = game();
    state.seats[0]!.hand.push({ id: "ws2", name: "Weighted Walking Stick" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ["Alice", "play:Weighted Walking Stick:basic:V1:ws"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    expect(dp.options.some((o) => o.id.includes("Weighted Walking Stick"))).toBe(false);
  });

  it("burns out when its counters run dry", () => {
    const state = game();
    // Two counters left and a strength-2 vampire: one strike empties it.
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);
    runTrace(engine, [
      ["Alice", "play:Weighted Walking Stick:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    stick(state)!.counters = 2;

    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range → close
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "ability:Weighted Walking Stick:ws:strike"],
      ["Bob", "strike:hand"],
      // Damage resolution: the acting minion's damage first (p. 29).
      ["Alice", "pass"], ["Bob", "pass"],
    ]);

    expect(stick(state)).toBeUndefined();
    expect(find(state, "M").blood).toBe(2); // the damage still landed
  });
});
