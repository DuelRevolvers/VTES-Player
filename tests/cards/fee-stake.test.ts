/**
 * Fee Stake (docs/fee-stake-design.md) — the Anarch title, taken by an
 * ACTION rather than won by a referendum. Six cards, one factory.
 *
 * What is worth pinning: the gate (Anarch, capacity 5+), that the title
 * lands with its CITY so two Barons of the same city contest, the clan
 * clause on three of the six, and the vote rider on the referendum that
 * burns the card.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** Everyone passes until the action is done (or `stop` says enough). */
function settle(engine: VtesEngine, stop?: () => boolean): void {
  for (let i = 0; i < 40; i++) {
    if (stop?.()) return;
    const dp = engine.decision();
    if (!dp) return;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
}

/** Alice holding Fee Stake: Boston, her V1 shaped by `who`. */
function table(who: Partial<MinionState>, card = "Fee Stake: Boston"): GameState {
  const state = threeSeatGame();
  state.seats[0]!.hand.push({ id: "fs", name: card });
  Object.assign(find(state, "V1")!, { sect: "anarch", capacity: 5, ...who });
  const tf = state.frames.find((f) => f.kind === "turn")!;
  if (tf.kind === "turn") tf.phase = "minion";
  return state;
}

describe("the gate (p. 10 requirements)", () => {
  it("NEGATIVE SPACE: needs an Anarch with capacity 5 or more", () => {
    const offered = (who: Partial<MinionState>): boolean =>
      ids(new VtesEngine(table(who), testRegistry)).some((i) => i.startsWith("play:Fee Stake"));
    expect(offered({})).toBe(true);
    expect(offered({ capacity: 4 })).toBe(false);
    expect(offered({ sect: "camarilla" })).toBe(false);
  });
});

describe("the title it grants", () => {
  it("makes the actor Baron OF BOSTON — the city, which is what contests", () => {
    const state = table({});
    const engine = new VtesEngine(state, testRegistry);
    const play = ids(engine).find((i) => i.startsWith("play:Fee Stake"))!;
    runTrace(engine, [["Alice", play]]);
    settle(engine, () => find(state, "V1")!.title !== null);
    const v1 = find(state, "V1")!;
    expect(v1.title).toBe("baron");
    expect(v1.titleCity).toBe("Boston");
  });

  it("the clan clause is on the three cards that print it, and reads the CALLER", () => {
    const statics = (name: string): Record<string, unknown> =>
      (testRegistry[name]!.attachOnSuccess!(null)?.statics ?? {}) as Record<string, unknown>;
    expect(statics("Fee Stake: Boston")["votesWhenCalling"]).toEqual({
      amount: 1,
      bearerClan: ["Toreador"],
    });
    expect(statics("Fee Stake: Corte")["votesWhenCalling"]).toBeUndefined();
  });

  it("all six cities are built, and each contests on ITS OWN city", () => {
    const cities: Array<[string, string]> = [
      ["Fee Stake: Boston", "Boston"],
      ["Fee Stake: Corte", "Corte"],
      ["Fee Stake: Los Angeles", "Los Angeles"],
      ["Fee Stake: New York", "New York"],
      ["Fee Stake: Perth", "Perth"],
      ["Fee Stake: Seattle", "Seattle"],
    ];
    for (const [name, city] of cities) {
      const r = testRegistry[name]!.attachOnSuccess!(null)!;
      expect(r.grantsTitle).toBe("baron");
      expect(r.grantsTitleCity).toBe(city);
      // Without `isUnique` two Barons of Boston is an illegal state
      // rather than a contest (the Praxis Seizure finding).
      expect(testRegistry[name]!.isUnique).toBe(true);
    }
  });
});

describe("the referendum that burns it", () => {
  it("is offered to any vampire, and seeds the -1 on non-Anarch titles", () => {
    const state = threeSeatGame();
    const baron = find(state, "V1")!;
    Object.assign(baron, { sect: "anarch", capacity: 5, title: "baron", titleCity: "Boston" });
    state.seats[0]!.permanents.push({
      card: { id: "fs", name: "Fee Stake: Boston" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Baron of Boston", "title"],
    });
    // Bob's W calls the referendum to burn it.
    Object.assign(find(state, "W")!, { sect: "camarilla", title: "prince", titleCity: "Dallas" });
    state.seats[1]!.minions.push(makeMinion("W2", "Bob", { sect: "camarilla" }));
    const tf = state.frames.find((f) => f.kind === "turn")!;
    if (tf.kind === "turn") {
      tf.phase = "minion";
      tf.seat = "Bob";
    }
    const engine = new VtesEngine(state, testRegistry);
    const act = ids(engine).find((i) => i.startsWith("act:Fee Stake: Boston"));
    expect(act).toBeDefined();
    runTrace(engine, [["Bob", act!]]);
    settle(engine, () => state.frames.some((f) => f.kind === "referendum"));
    const rf = state.frames.find((f) => f.kind === "referendum");
    expect(rf?.kind === "referendum" && rf.voteModifiers).toEqual([
      { amount: -1, titledOnly: true, notSect: "anarch" },
    ]);
  });
});
