/**
 * The basic combat cards (docs/basic-combat-design.md).
 *
 * Dodge (100567), Fake Out (100693), Boxed In (100244),
 * Dead-End Alley (100504), Open Grate (101323).
 *
 * The effects are six waves old and pinned elsewhere. What is new is
 * "DO NOT REPLACE UNTIL AFTER COMBAT" — a deferral held on the COMBAT
 * frame rather than the action's, because combat ends first — and Open
 * Grate's "only usable to end combat", which is offered in exactly the
 * window the other presses are not.
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function combat(state: GameState): CombatFrame | undefined {
  const f = state.frames.find((x) => x.kind === "combat");
  return f?.kind === "combat" ? f : undefined;
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

/** Alice's V1 bleeds, Bob's M blocks; combat is live at before-range. */
function intoCombat(cards: string[]) {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { disciplines: {}, blood: 5, strength: 1 });
  Object.assign(find(state, "M"), { disciplines: {}, blood: 5, strength: 1 });
  cards.forEach((name, i) => state.seats[0]!.hand.push({ id: `x${i}`, name }));
  // The fixture's library is empty, and an empty library replaces
  // nothing — so a test about replacement has to give it something to
  // draw, or it would pass by the draw never happening.
  state.seats[0]!.library.push({ id: "lib1", name: "Dodge" });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  return { state, engine };
}

describe("do not replace until after combat", () => {
  it("holds the replacement on the COMBAT frame, and pays it when combat ends", () => {
    const { state, engine } = intoCombat(["Fake Out"]);
    const before = state.seats[0]!.hand.length;
    expect(walkTo(engine, "play:Fake Out")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Fake Out"))!],
    ]);
    // Played, resolved — and the hand is one card SHORT. An ordinary
    // combat card would have been replaced by now.
    for (let i = 0; i < 6 && combat(state)?.drawAfterCombat?.length !== 1; i++) step(engine);
    expect(combat(state)!.drawAfterCombat).toEqual(["Alice"]);
    expect(state.seats[0]!.hand.length).toBe(before - 1);

    for (let i = 0; i < 80 && combat(state); i++) {
      if (!step(engine)) break;
    }
    expect(combat(state)).toBeUndefined();
    expect(state.seats[0]!.hand.length).toBe(before);
  });
});

describe("the two restricted presses", () => {
  it("Open Grate is NOT offered while no press is standing…", () => {
    const { engine } = intoCombat(["Open Grate", "Dead-End Alley"]);
    expect(walkTo(engine, "play:Dead-End Alley")).toBe(true);
    // The control: at this exact moment a continue-only press IS on
    // offer, so the absence below is the restriction and not the window.
    expect(optionIds(engine).some((o) => o.startsWith("play:Open Grate"))).toBe(false);
  });

  it("…and IS offered once one is, where Dead-End Alley no longer is", () => {
    const { state, engine } = intoCombat(["Open Grate", "Dead-End Alley"]);
    expect(walkTo(engine, "play:Dead-End Alley")).toBe(true);
    const cf = combat(state)!;
    // A press is now standing (p. 32): the only thing a press can do from
    // here is cancel it, which is what "only usable to end combat" means.
    cf.willContinue = true;
    expect(walkTo(engine, "play:Open Grate", 4)).toBe(true);
    expect(optionIds(engine).some((o) => o.startsWith("play:Dead-End Alley"))).toBe(false);
  });
});

describe("Dodge and Boxed In are offered where they belong", () => {
  it("Dodge in the strike step, Boxed In in the press step", () => {
    const { engine } = intoCombat(["Dodge"]);
    expect(walkTo(engine, "play:Dodge")).toBe(true);
    expect(engine.decision()!.window).toBe("combat.chooseStrike");
  });

  it("Boxed In is a press", () => {
    const { engine } = intoCombat(["Boxed In"]);
    expect(walkTo(engine, "play:Boxed In")).toBe(true);
    expect(engine.decision()!.window).toBe("combat.press");
  });
});
