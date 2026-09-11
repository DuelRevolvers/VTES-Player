/**
 * The combat retainers (docs/combat-retainers-design.md).
 *
 * Vengeful Spirit (102107), Zombie (102210), Resplendent Protector
 * (101612).
 *
 * `combatRoundDamage` is six waves old, so Vengeful Spirit needed no new
 * mechanism at all. The two that did are the other shapes a retainer
 * takes in a fight: one that PREVENTS without being spent, and one that
 * IS spent, for something the fight has nothing to do with.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function entry(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [], ...over };
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function step(engine: VtesEngine): boolean {
  const dp = engine.decision();
  if (!dp) return false;
  runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  return true;
}

function walkTo(engine: VtesEngine, prefix: string, limit = 60): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    step(engine);
  }
  return false;
}

/** Alice's V1 bleeds; Bob's W blocks, carrying `retainer`. */
function combatWith(retainer: PermanentInPlay): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  state.seats[0]!.minions[0]!.blood = 5;
  const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
  w.blood = 5;
  w.attached.push(retainer);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:W"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  return { state, engine };
}

describe("Resplendent Protector (101612)", () => {
  it("prevents once each COMBAT without being locked or burned", () => {
    const { state, engine } = combatWith(
      entry("rp1", "Resplendent Protector", { life: 1, tags: ["mortal"] }),
    );
    expect(walkTo(engine, "ability:Resplendent Protector")).toBe(true);
    const id = optionIds(engine).find((o) => o.startsWith("ability:Resplendent Protector"))!;
    runTrace(engine, [["Bob", id]]);
    const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
    // Still there, still unlocked: the latch is per-combat, not a cost.
    const rp = w.attached.find((p) => p.card.id === "rp1");
    expect(rp).toBeDefined();
    expect(rp!.locked).toBe(false);
    // And it is spent — the same combat does not offer it twice.
    expect(walkTo(engine, "ability:Resplendent Protector", 25)).toBe(false);
  });
});

describe("Zombie (102210)", () => {
  it("can be burned for 2 blood as a stealth action", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.blood = 1;
    v1.attached.push(entry("z1", "Zombie", { life: 2, tags: ["zombie"] }));
    const engine = new VtesEngine(state, testRegistry);
    expect(walkTo(engine, "act:Zombie", 10)).toBe(true);
    const id = optionIds(engine).find((o) => o.startsWith("act:Zombie"))!;
    runTrace(engine, [["Alice", id]]);
    for (let i = 0; i < 20 && v1.attached.some((p) => p.card.id === "z1"); i++) step(engine);
    // The retainer paid for the blood, and both halves happened.
    expect(v1.attached.some((p) => p.card.id === "z1")).toBe(false);
    expect(v1.blood).toBe(3);
  });
});

describe("Vengeful Spirit (102107)", () => {
  it("needed nothing new: +1 bleed and 1 damage a round, both already data", () => {
    const spec = testRegistry["Vengeful Spirit"]!;
    expect(spec.permanentStatics?.bleed).toBe(1);
    expect(spec.permanentStatics?.combatRoundDamage).toEqual({ amount: 1, ranged: false });
  });
});
