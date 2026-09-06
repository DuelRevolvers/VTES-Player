/**
 * Carver's Meat Packing and Storage (100303) — hostage counters, the
 * first named counters that sit on a *minion* without belonging to any
 * Methuselah (`MinionState.counters`, unlike per-owner `corruption`).
 *
 *   After a vampire with capacity 3 or less goes to torpor, put 1 hostage
 *   counter on them. Vampires with any hostage counters cannot be moved
 *   to the ready region or be diablerized. Lock during your master phase
 *   to add X blood to a ready vampire you control, where X is the number
 *   of vampires with any hostage counters. During any unlock phase, any
 *   ready vampire can burn 2 blood to burn any vampire's hostage
 *   counters. After this card leaves play, burn all the hostage counters.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const CARD = "Carver's Meat Packing and Storage";

function carvers(seat = "Alice"): PermanentInPlay {
  return {
    card: { id: "cmp", name: CARD },
    controller: seat,
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["location", CARD],
  };
}

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function hostageCount(state: GameState, id: string): number {
  return find(state, id).counters?.["hostage"] ?? 0;
}

describe("Carver's Meat Packing (100303)", () => {
  /** V1 bleeds, `blocker` blocks, both hand-strike: the blocker with no
   *  blood to mend with goes to torpor. */
  function torporByCombat(state: GameState, blocker: string): VtesEngine {
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", `block:${blocker}`],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range → close
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"],
      ["Alice", "pass"], ["Bob", "pass"], // damage resolution
    ]);
    return engine;
  }

  it("puts a hostage counter on a small vampire that goes to torpor", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(carvers());
    Object.assign(find(state, "M"), { capacity: 3, blood: 0 });
    torporByCombat(state, "M");

    expect(find(state, "M").inTorpor).toBe(true);
    expect(hostageCount(state, "M")).toBe(1);
  });

  it("leaves a bigger vampire alone", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(carvers());
    Object.assign(find(state, "M"), { capacity: 4, blood: 0 });
    torporByCombat(state, "M");

    expect(find(state, "M").inTorpor).toBe(true);
    expect(hostageCount(state, "M")).toBe(0); // capacity 4
  });

  it("stops a hostage leaving torpor, being rescued, or being diablerized", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(carvers());
    // Bob's M is in torpor with the blood to leave, and held hostage.
    Object.assign(find(state, "M"), {
      inTorpor: true,
      blood: 3,
      counters: { hostage: 1 },
    });
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    const dp = new VtesEngine(state, testRegistry).decision()!;

    expect(dp.options.some((o) => o.id === "leave:M")).toBe(false);
    expect(dp.options.some((o) => o.id.startsWith("rescue:"))).toBe(false);
    expect(dp.options.some((o) => o.id.startsWith("diablerize:"))).toBe(false);
  });

  it("releases them when the counters go, and they can act again", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(carvers());
    Object.assign(find(state, "M"), { inTorpor: true, blood: 3 });
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    const dp = new VtesEngine(state, testRegistry).decision()!;

    expect(dp.options.some((o) => o.id === "leave:M")).toBe(true);
  });

  it("locks in its controller's master phase to feed X blood", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(carvers());
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    // Two hostages in the game → X = 2.
    find(state, "M").counters = { hostage: 1 };
    find(state, "N").counters = { hostage: 2 };
    find(state, "V1").blood = 1;
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", `ability:${CARD}:cmp:feed:V1`]]);

    expect(find(state, "V1").blood).toBe(3);
    expect(state.seats[0]!.permanents[0]!.locked).toBe(true);
  });

  it("lets any Methuselah's ready vampire buy a hostage out for 2 blood", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(carvers());
    find(state, "M").counters = { hostage: 2 };
    Object.assign(find(state, "N"), { blood: 3 }); // Carol's vampire pays
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Carol";
      tf.phase = "unlock";
      tf.unlockDone = false;
      tf.unlockAbilitiesDone = false;
    }
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Carol");
    const free = dp.options.find((o) => o.id.includes(":free:N:M"));
    expect(free).toBeDefined();
    engine.choose(free!.id);

    // All of them go at once ("burn any vampire's hostage counters").
    expect(hostageCount(state, "M")).toBe(0);
    expect(find(state, "N").blood).toBe(1);
  });

  it("burns every hostage counter when it leaves play", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(carvers());
    state.seats[0]!.minions.push(makeMinion("V2", "Alice"));
    find(state, "M").counters = { hostage: 1 };
    find(state, "V2").counters = { hostage: 3 };
    const engine = new VtesEngine(state, testRegistry);

    engine.burnPermanent("cmp");

    expect(hostageCount(state, "M")).toBe(0);
    expect(hostageCount(state, "V2")).toBe(0);
  });
});
