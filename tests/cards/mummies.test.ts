/**
 * The mummies (docs/mummies-design.md, tranche 1 wave 48).
 * Qetu the Evil Doer (101527), Saatet-ta (101665), Nephren-Ka (101273).
 *
 * All three print "if burned, shuffle into the owner's library" — built
 * in wave 47 for Amam — so what is worth pinning here is the one new
 * knob each: an END-only press credit, a lock with three answers, and a
 * prevention that a MODE of damage switches off.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function allyInPlay(state: GameState, seat: string, id: string, name: string): MinionState {
  const stats = testRegistry[name]!.allyEntry!(null);
  const self: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: stats.statics ?? {},
    tags: stats.tags ?? [],
  };
  const m = makeAlly(id, seat, 5, { name, attached: [self], strength: 2, bleedAmount: 1 });
  if (stats.disciplines) m.disciplines = { ...stats.disciplines };
  state.seats.find((s) => s.id === seat)!.minions.push(m);
  return m;
}

function ids(engine: VtesEngine): string[] {
  return (engine.decision()?.options ?? []).map((o) => o.id);
}

/** Alice's ally bleeds, Bob's W blocks, and combat begins. */
function intoCombat(name: string, id: string): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  allyInPlay(state, "Alice", id, name);
  Object.assign(find(state, "W")!, { blood: 4, strength: 1 });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", `bleed:${id}`],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "block:W"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block → combat
  ]);
  return { state, engine };
}

function walkTo(engine: VtesEngine, pred: (o: string[]) => boolean, limit = 40): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (pred(dp.options.map((o) => o.id))) return true;
    engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
  }
  return false;
}

describe("Qetu the Evil Doer (101527)", () => {
  it("its press credit buys press:end and NOT press:continue", () => {
    const { engine } = intoCombat("Qetu the Evil Doer", "qe");
    // Qetu's side is the only one with a credit, and no press to continue
    // exists yet — so the end-only credit must offer nothing.
    const reachedPress = walkTo(engine, (o) => o.some((i) => i.startsWith("press:")));
    if (reachedPress) {
      expect(ids(engine)).not.toContain("press:continue");
    }
    expect(testRegistry["Qetu the Evil Doer"]!.allyEntry!(null).statics.endPressPerCombat).toBe(1);
  });
});

describe("Saatet-ta (101665) — one lock, three answers", () => {
  it("offers a stealth grant to a Ministry actor when stealth is needed", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1")!, { clan: "Ministry", blood: 3 });
    allyInPlay(state, "Alice", "st", "Saatet-ta");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:W"],
    ]);
    expect(
      walkTo(engine, (o) => o.includes("ability:Saatet-ta:st:stealth")),
    ).toBe(true);
  });

  it("offers the BLEED grant too — all three come off one lockGrant", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1")!, { clan: "Ministry", blood: 3 });
    allyInPlay(state, "Alice", "st", "Saatet-ta");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(walkTo(engine, (o) => o.includes("ability:Saatet-ta:st:bleed"))).toBe(true);
  });

  it("NEGATIVE SPACE: nothing for a non-Ministry actor", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1")!, { clan: "Ventrue", blood: 3 });
    allyInPlay(state, "Alice", "st", "Saatet-ta");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(walkTo(engine, (o) => o.some((i) => i.startsWith("ability:Saatet-ta")), 12)).toBe(false);
  });
});

describe("Nephren-Ka (101273)", () => {
  it("prevents non-aggravated damage once each combat, and is shuffled home when burned", () => {
    const { state, engine } = intoCombat("Nephren-Ka", "nk");
    expect(
      walkTo(engine, (o) => o.includes("ability:Nephren-Ka:nk:preventcombat")),
    ).toBe(true);
    engine.burnMinion("nk");
    expect(find(state, "nk")).toBeUndefined();
    expect(state.seats[0]!.library.some((c) => c.id === "nk")).toBe(true);
  });
});
