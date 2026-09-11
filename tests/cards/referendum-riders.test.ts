/**
 * Referendum OUTCOME riders (docs/referendum-riders-design.md).
 *
 * Elder Kindred Network (100619), Bribes (100251), Malkavian Rider Clause
 * (101156), Cryptic Rider (100478).
 *
 * `postTally` could already carry a payload past the tally (Scorn of
 * Adonis) but could not ask WHICH WAY the result went, and nothing could
 * read the margin there. These four need both.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function toPolling(): Array<[string, string]> {
  return [
    ["Alice", "play:Anarchist Uprising"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → polling
  ];
}

/** Alice calls Anarchist Uprising; Bob's W is a prince with votes. */
function votingGame(): GameState {
  const state = threeSeatGame();
  state.seats[0]!.minions[0]!.title = "prince";
  state.seats[0]!.hand.push({ id: "au1", name: "Anarchist Uprising" });
  state.seats[1]!.minions[0]!.title = "prince";
  return state;
}

/** Events emitted strictly after the tally — the only ones a post-tally
 *  rider can be credited with. */
function afterTally(state: GameState): GameState["eventLog"] {
  const at = state.eventLog.findIndex((e) => e.type === "ReferendumResolved");
  expect(at).toBeGreaterThanOrEqual(0);
  return state.eventLog.slice(at + 1);
}

describe("Elder Kindred Network (100619)", () => {
  it("on a FAIL, burns the caller 1 plus 1 per vote of difference", () => {
    const state = votingGame();
    state.seats[1]!.hand.push({ id: "ekn", name: "Elder Kindred Network" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ...toPolling(),
      ["Alice", "pass"],
      ["Bob", "play:Elder Kindred Network"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      // Alice casts nothing; Bob's prince votes against. Margin −2.
      ["Alice", "pass"],
      ["Bob", "vote:W:against"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // quiesce → tally
    ]);
    expect(state.eventLog.some((e) => e.type === "ReferendumResolved" && !e.passed)).toBe(true);
    // 1 base + 1 per vote of difference, and the difference is the SIZE of
    // a negative margin.
    expect(
      afterTally(state).some(
        (e) => e.type === "PoolBurned" && e.seat === "Alice" && e.amount === 3,
      ),
    ).toBe(true);
  });

  it("NEGATIVE SPACE: a referendum that PASSES costs the caller nothing extra", () => {
    // Anarchist Uprising charges the caller when it passes, so "no burn"
    // is not assertable here. The control is the same game WITHOUT the
    // card: if the rider stayed quiet, the two pools match.
    const run = (withCard: boolean): number => {
      const state = votingGame();
      if (withCard) state.seats[1]!.hand.push({ id: "ekn", name: "Elder Kindred Network" });
      const engine = new VtesEngine(state, testRegistry);
      runTrace(engine, [
        ...toPolling(),
        ...(withCard
          ? ([
              ["Alice", "pass"],
              ["Bob", "play:Elder Kindred Network"],
              ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
            ] as Array<[string, string]>)
          : []),
        ["Alice", "vote:V1:for"], // Alice's own prince carries it
        ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ]);
      expect(state.eventLog.some((e) => e.type === "ReferendumResolved" && e.passed)).toBe(true);
      return state.seats[0]!.pool;
    };
    expect(run(true)).toBe(run(false));
  });
});

describe("Bribes (100251)", () => {
  it("pays the player now, and every other seat that voted only in favour", () => {
    const state = votingGame();
    state.seats[0]!.hand.push({ id: "br", name: "Bribes" });
    state.seats[2]!.minions[0]!.title = "prince";
    const engine = new VtesEngine(state, testRegistry);
    const alicePool = state.seats[0]!.pool;
    runTrace(engine, [
      ...toPolling(),
      ["Alice", "play:Bribes"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    // "Gain 1 pool" is immediate, before any vote is cast.
    expect(state.seats[0]!.pool).toBe(alicePool + 1);
    // Casting a vote rewinds the impulse to the acting seat, so Alice is
    // asked again between each of the others' ballots.
    runTrace(engine, [
      ["Alice", "vote:V1:for"],
      ["Alice", "pass"], ["Bob", "vote:W:against"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "vote:N:for"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const paid = afterTally(state).filter((e) => e.type === "PoolGained");
    // Carol voted for and never against — she is paid. Bob voted against.
    // Alice played the card and is not an "other Methuselah".
    expect(paid.some((e) => e.type === "PoolGained" && e.seat === "Carol")).toBe(true);
    expect(paid.some((e) => e.type === "PoolGained" && e.seat === "Bob")).toBe(false);
    expect(paid.some((e) => e.type === "PoolGained" && e.seat === "Alice")).toBe(false);
  });
});

describe("the auto-pass grant", () => {
  it("Malkavian Rider Clause arms the NEXT referendum once this one passes", () => {
    const state = votingGame();
    state.seats[1]!.hand.push({ id: "mrc", name: "Malkavian Rider Clause" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ...toPolling(),
      ["Alice", "pass"],
      ["Bob", "play:Malkavian Rider Clause"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "vote:V1:for"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(state.eventLog.some((e) => e.type === "ReferendumResolved" && e.passed)).toBe(true);
    // BOB played it, so BOB is armed — not the caller.
    expect(state.seats[1]!.autoPassReferendum).toEqual({});
    expect(state.seats[0]!.autoPassReferendum).toBeUndefined();
  });

  it("NEGATIVE SPACE: nothing is armed when the referendum fails", () => {
    const state = votingGame();
    state.seats[1]!.hand.push({ id: "mrc", name: "Malkavian Rider Clause" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ...toPolling(),
      ["Alice", "pass"],
      ["Bob", "play:Malkavian Rider Clause"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "vote:W:against"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(state.eventLog.some((e) => e.type === "ReferendumResolved" && !e.passed)).toBe(true);
    expect(state.seats[1]!.autoPassReferendum).toBeUndefined();
  });

  it("Día de los Muertos still carries its own sect and turn clauses", () => {
    // The grant now holds the CARD's conditions rather than the engine
    // holding one card's. This is the card that used to own them.
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    state.seats[0]!.hand = [{ id: "dd", name: "Día de los Muertos" }];
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Día de los Muertos"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(state.seats[0]!.autoPassReferendum).toEqual({
      sect: "sabbat",
      thisTurnOnly: true,
    });
  });
});

describe("Cryptic Rider (100478)", () => {
  it("arms the grant from the after-resolution window of a PASSED referendum", () => {
    const state = votingGame();
    state.seats[0]!.hand.push({ id: "cr", name: "Cryptic Rider" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ...toPolling(),
      ["Alice", "vote:V1:for"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // quiesce → tally
      // "Only usable ON A SUCCESSFUL referendum" — the window only opens
      // on a pass, so the condition IS the window.
      ["Alice", "play:Cryptic Rider"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    // "…calls THIS TURN" — unlike Malkavian Rider Clause, which waits.
    expect(state.seats[0]!.autoPassReferendum).toEqual({ thisTurnOnly: true });
  });
});
