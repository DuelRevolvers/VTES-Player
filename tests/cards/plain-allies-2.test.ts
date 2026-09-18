/**
 * Plain allies II (docs/plain-allies-design.md §4, tranche 1 wave 46).
 * Thadius Zho (101963), ECTU Operative (102237), Rom Gypsy (101650).
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function allyInPlay(state: GameState, seat: string, id: string, name: string, life: number): MinionState {
  const stats = testRegistry[name]?.allyEntry?.(null);
  const self: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: stats?.statics ?? {},
    tags: stats?.tags ?? [],
  };
  const m = makeAlly(id, seat, life, { name, attached: [self] });
  state.seats.find((s) => s.id === seat)!.minions.push(m);
  return m;
}

function ids(engine: VtesEngine): string[] {
  return (engine.decision()?.options ?? []).map((o) => o.id);
}

function settle(engine: VtesEngine, state: GameState): void {
  for (let i = 0; i < 40; i++) {
    if (!state.frames.some((f) => f.kind === "action")) return;
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

describe("Thadius Zho (101963)", () => {
  it("burns 1 blood from ANOTHER Methuselah's ready vampire, at +1 stealth", () => {
    const state = threeSeatGame();
    allyInPlay(state, "Alice", "tz", "Thadius Zho", 2);
    find(state, "W").blood = 3;
    const engine = new VtesEngine(state, testRegistry);
    const acts = ids(engine).filter((o) => o.startsWith("act:Thadius Zho:tz"));
    expect(acts.some((o) => o.includes("blood:W"))).toBe(true);
    expect(acts.some((o) => o.includes("blood:V1"))).toBe(false); // his own
    runTrace(engine, [["Alice", acts.find((o) => o.includes("blood:W"))!]]);
    settle(engine, state);
    expect(find(state, "W").blood).toBe(2);
    expect(testRegistry["Thadius Zho"]!.allyEntry!(null).statics.maneuverPerCombat).toBe(1);
  });
});

describe("ECTU Operative (102237)", () => {
  it("burns a vampire in torpor as a Ⓓ action", () => {
    const state = threeSeatGame();
    allyInPlay(state, "Alice", "ec", "ECTU Operative", 3);
    state.seats[1]!.minions.push(makeMinion("T", "Bob", { inTorpor: true, blood: 1, capacity: 3 }));
    const engine = new VtesEngine(state, testRegistry);
    const acts = ids(engine).filter((o) => o.startsWith("act:ECTU Operative:ec"));
    expect(acts).toEqual(["act:ECTU Operative:ec:granted:ec:torpor:T"]); // not the ready W or M
    runTrace(engine, [["Alice", acts[0]!]]);
    settle(engine, state);
    expect(state.seats[1]!.minions.some((m) => m.id === "T")).toBe(false);
  });
});

describe("Rom Gypsy (101650)", () => {
  it("locks to give a Ravnos you control +1 stealth", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { clan: "Ravnos", blood: 3 });
    allyInPlay(state, "Alice", "rg", "Rom Gypsy", 2);
    const engine = new VtesEngine(state, testRegistry);
    // Stealth is only offered when NEEDED (p. 26), so W has to be trying
    // to block before the lock is on the table.
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:W"],
    ]);
    let offered = false;
    for (let i = 0; i < 8 && !offered; i++) {
      const dp = engine.decision()!;
      const grant = dp.options.find((o) => o.id.startsWith("ability:Rom Gypsy:rg"));
      if (grant) {
        offered = true;
        runTrace(engine, [[dp.seat, grant.id]]);
        break;
      }
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    expect(offered).toBe(true);
    expect(find(state, "rg").attached[0]!.locked).toBe(true);
  });
});
