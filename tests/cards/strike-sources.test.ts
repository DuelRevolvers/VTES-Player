/**
 * What a strike is made of (docs/strike-sources-design.md).
 *
 * Channeling the Beast (100328), Lucky Blow (101131), Up Yours! (102083),
 * Backflip (100123).
 *
 * Three of the four are data on machinery that already exists. The one
 * that is not is Up Yours!, whose damage is printed on somebody else's
 * card — so that is where the assertions are.
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
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

function entry(id: string, name: string, tags: string[]): PermanentInPlay {
  const h = testRegistry[name];
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h?.permanentStatics ?? {},
    tags,
  };
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function walkTo(engine: VtesEngine, prefix: string, limit = 30): boolean {
  for (let i = 0; i < limit; i++) {
    if (optionIds(engine).some((x) => x.startsWith(prefix))) return true;
    const dp = engine.decision();
    if (!dp) return false;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
  return optionIds(engine).some((x) => x.startsWith(prefix));
}

/** Alice's V1 bleeds, Bob's M blocks; combat is live. `card` is in
 *  Alice's hand under an id the fixture does not already use. */
function inCombat(card: string, setup: (s: GameState) => void = () => {}) {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { blood: 5, strength: 1 });
  Object.assign(find(state, "M"), { blood: 5, strength: 1 });
  state.seats[0]!.hand.push({ id: "wave", name: card });
  setup(state);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  return { state, engine };
}

/** Answer everything cheaply until the combat frame is gone. */
function drain(engine: VtesEngine, state: GameState, limit = 60): void {
  for (let i = 0; i < limit && combat(state); i++) {
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

// ---------------------------------------------------------------------------

describe("Up Yours! (102083)", () => {
  it("strikes for the POOL COST of the weapon chosen from the opposing minion", () => {
    // .44 Magnum costs 2 pool, Sawed-Off Shotgun 2 — use one of each so
    // the option list proves the choice is per weapon, then take the one
    // whose cost is not the other's.
    const { state, engine } = inCombat("Up Yours!", (s) => {
      find(s, "M").attached.push(entry("gun", "Combat Shotgun", ["weapon", "gun"]));
    });
    combat(state)!.range = "close";
    expect(walkTo(engine, "play:Up Yours!:basic:V1:gun")).toBe(true);
    runTrace(engine, [["Alice", optionIds(engine).find((i) => i.startsWith("play:Up Yours!"))!]]);
    drain(engine, state);
    // Combat Shotgun costs 3 pool, so the strike is for 3.
    expect(find(state, "M").blood).toBe(2);
  });

  it("NEGATIVE SPACE: no weapon on the opponent, nothing to choose", () => {
    const { state, engine } = inCombat("Up Yours!");
    combat(state)!.range = "close";
    expect(walkTo(engine, "play:Up Yours!", 12)).toBe(false);
  });
});

describe("Channeling the Beast (100328) and Lucky Blow (101131)", () => {
  it("both offer the hand strike AND the melee weapon, at +1", () => {
    for (const name of ["Channeling the Beast", "Lucky Blow"]) {
      const { state, engine } = inCombat(name, (s) => {
        find(s, "V1").attached.push(entry("axe", "Sengir Dagger", ["weapon", "melee"]));
      });
      combat(state)!.range = "close";
      expect(walkTo(engine, `play:${name}:basic:V1:axe`)).toBe(true);
      // …and the plain hand strike is still there beside it.
      expect(optionIds(engine).some((i) => i === `play:${name}:basic:V1:wave`)).toBe(true);
    }
  });
});

describe("Backflip (100123)", () => {
  it("NEGATIVE SPACE: long range only", () => {
    const { state, engine } = inCombat("Backflip");
    combat(state)!.range = "close";
    expect(walkTo(engine, "play:Backflip", 12)).toBe(false);
  });

  it("…and dodges with a press at long range", () => {
    const { state, engine } = inCombat("Backflip");
    combat(state)!.range = "long";
    expect(walkTo(engine, "play:Backflip")).toBe(true);
    runTrace(engine, [["Alice", optionIds(engine).find((i) => i.startsWith("play:Backflip"))!]]);
    // Read the CREDIT rather than walking to the press option: the press
    // step is several windows away and a walker that passes its way there
    // can end the combat before it arrives.
    for (let i = 0; i < 6; i++) {
      const dp = engine.decision();
      if (!dp || (combat(state)?.pressesCombat.acting ?? 0) > 0) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(combat(state)!.pressesCombat.acting).toBe(1);
  });
});
