/**
 * First strike (docs/first-strike-design.md).
 *
 * p. 33: a first strike is "resolved before a normal strike. Thus, if the
 * opposing minion is burned or sent to torpor … [their strike] will not
 * be resolved at all." If both have it, "strikes are resolved
 * simultaneously", and "dodge still works against" one.
 *
 * A kernel mechanic with no cards in the pool yet, so the tests set the
 * three sources on the frame directly — the strike, a static on the
 * minion, and the round-scoped grant.
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "./fixtures.ts";

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function combat(state: GameState): CombatFrame | undefined {
  const f = state.frames.find((x) => x.kind === "combat");
  return f?.kind === "combat" ? f : undefined;
}

/** Alice's V1 bleeds, Bob's M blocks; combat is live at BEFORE RANGE. */
function inCombat(setup: (s: GameState) => void = () => {}) {
  const state = threeSeatGame();
  Object.assign(find(state, "V1")!, { blood: 5, strength: 2 });
  Object.assign(find(state, "M")!, { blood: 1, strength: 2 });
  setup(state);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  combat(state)!.range = "close";
  return { state, engine };
}

/** Answer everything cheaply until the combat frame is gone. */
function drain(engine: VtesEngine, state: GameState, limit = 80): void {
  for (let i = 0; i < limit && combat(state); i++) {
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

/** Both minions declare a plain hand strike. */
function bothStrikeByHand(engine: VtesEngine, state: GameState): void {
  for (let i = 0; i < 12 && combat(state)?.step !== "damageResolution"; i++) {
    const dp = engine.decision();
    if (!dp) break;
    const hand = dp.options.find((o) => o.id === "strike:hand");
    runTrace(engine, [[dp.seat, (hand ?? dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

function damageEvents(state: GameState): string[] {
  return state.eventLog
    .filter((e) => e.type === "DamageInflicted")
    .map((e) => `${e.minion}/${e.amount}`);
}

// ---------------------------------------------------------------------------

describe("first strike", () => {
  it("a minion killed by the first strike never strikes back", () => {
    // M has 1 blood and takes 2: it goes to torpor before its own strike
    // is resolved, so V1 takes nothing at all.
    const { state, engine } = inCombat((s) => {
      find(s, "V1")!.attached.push({
        card: { id: "fs", name: "Muddled Vampire Hunter" },
        locked: false,
        usedThisPhase: false,
        statics: { firstStrike: true },
        tags: [],
      });
    });
    bothStrikeByHand(engine, state);
    drain(engine, state);
    expect(find(state, "M")?.inTorpor).toBe(true);
    // The whole point: only ONE packet of damage was ever inflicted.
    expect(damageEvents(state)).toEqual(["M/2"]);
    expect(find(state, "V1")!.blood).toBe(5);
  });

  it("NEGATIVE SPACE: without it the same round trades blows", () => {
    // The control. Identical fixture, no first strike — both land, which
    // is what makes the test above a test of first strike and not of a
    // minion with 1 blood.
    const { state, engine } = inCombat();
    bothStrikeByHand(engine, state);
    drain(engine, state);
    expect(damageEvents(state).sort()).toEqual(["M/2", "V1/2"]);
  });

  it("BOTH sides having it is the same as neither (p. 33)", () => {
    const { state, engine } = inCombat((s) => {
      for (const id of ["V1", "M"]) {
        find(s, id)!.attached.push({
          card: { id: `fs-${id}`, name: "Muddled Vampire Hunter" },
          locked: false,
          usedThisPhase: false,
          statics: { firstStrike: true },
          tags: [],
        });
      }
    });
    bothStrikeByHand(engine, state);
    drain(engine, state);
    expect(damageEvents(state).sort()).toEqual(["M/2", "V1/2"]);
  });

  it("the round-scoped grant is a third source, and it survives to resolution", () => {
    const { state, engine } = inCombat();
    combat(state)!.firstStrikeRound = { acting: true, opposing: false };
    bothStrikeByHand(engine, state);
    drain(engine, state);
    expect(damageEvents(state)).toEqual(["M/2"]);
  });

  it("a dodge still works against a first strike", () => {
    const { state, engine } = inCombat((s2) => {
      find(s2, "M")!.blood = 5;
      find(s2, "V1")!.attached.push({
        card: { id: "fs", name: "Muddled Vampire Hunter" },
        locked: false,
        usedThisPhase: false,
        statics: { firstStrike: true },
        tags: [],
      });
    });
    // Pre-declare M's dodge on the frame — no dodge card in the pool has
    // no discipline requirement, and what is under test is the ORDERING,
    // not how the dodge was declared.
    const cf = combat(state)!;
    for (let i = 0; i < 12 && cf.step !== "chooseStrike"; i++) {
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    cf.strikes.opposing = {
      source: "hand",
      name: null,
      handBonus: 0,
      damage: 0,
      ranged: false,
      combatEnds: false,
      unlockSelf: false,
      dodge: true,
      aggravated: false,
      stealBlood: 0,
    };
    bothStrikeByHand(engine, state);
    drain(engine, state);
    // The first strike was cancelled on the dodging minion, and the
    // dodge itself deals nothing — so nobody took damage.
    expect(damageEvents(state)).toEqual([]);
    expect(find(state, "M")!.blood).toBe(5);
  });
});
