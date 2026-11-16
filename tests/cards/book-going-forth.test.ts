/**
 * The Book of Going Forth by Night (100239) — "If an ally opposing this
 * vampire in combat would be burned, instead steal and lock the ally; if
 * the ally has lost their last life, they gain 1 life."
 */
import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}
function combat(state: GameState): CombatFrame | undefined {
  const f = state.frames.find((x) => x.kind === "combat");
  return f?.kind === "combat" ? f : undefined;
}

/** Alice's V1 (carrying the Book when `withBook`) bleeds; Bob's ally A blocks. */
function intoCombat(withBook: boolean) {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { blood: 5, strength: 1 });
  const ally = makeAlly("A", "Bob", 3);
  state.seats[1]!.minions.push(ally);
  if (withBook) {
    find(state, "V1").attached.push({
      card: { id: "book", name: "The Book of Going Forth by Night" },
      locked: false,
      usedThisPhase: false,
      statics: testRegistry["The Book of Going Forth by Night"]!.permanentStatics ?? {},
      tags: [],
    });
  }
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:A"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  return { state, engine, ally: find(state, "A") };
}

describe("The Book of Going Forth by Night", () => {
  it("steals and locks an opposing ally that would be burned, and it gains 1 life", () => {
    const { state, engine, ally } = intoCombat(true);
    expect(combat(state)).toBeDefined();
    ally.blood = 0;
    engine.decision(); // settle: the burn is decided here
    expect(state.seats[1]!.minions.some((m) => m.id === "A")).toBe(false);
    expect(state.seats[0]!.minions.some((m) => m.id === "A")).toBe(true);
    expect(find(state, "A").locked).toBe(true);
    expect(find(state, "A").blood).toBe(1);
    for (let i = 0; i < 80 && combat(state); i++) {
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(combat(state)).toBeUndefined();
  });

  it("control: without the Book the same ally is burned", () => {
    const { state, engine, ally } = intoCombat(false);
    ally.blood = 0;
    engine.decision();
    expect(state.seats.flatMap((s) => s.minions).some((m) => m.id === "A")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "MinionBurned" && e.minion === "A")).toBe(true);
  });
});
