/**
 * The politics gate (docs/politics-design.md): the political action,
 * the referendum state machine (terms → polling → resolve), every vote
 * source, and the eight wave referendums.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function entry(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [], ...over };
}

/** play → as-played (3) → announce (3) → A (3) → C (3): 13 steps to a
 *  successful undirected political action, referendum next. */
function politicalActionTrace(cardPrefix: string): Array<[string, string]> {
  return [
    ["Alice", cardPrefix],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ];
}

describe("the referendum machine (Kine Resources Contested, 101056)", () => {
  it("terms → polling with every vote source → tally → effects", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.title = "prince"; // 2 votes
    state.seats[1]!.minions.find((x) => x.id === "W")!.title = "primogen"; // 1 vote
    alice.hand.push({ id: "krc1", name: "Kine Resources Contested" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...politicalActionTrace("play:Kine Resources Contested"),
      // Referendum. Terms: 4 pool split across Bob and Carol.
      ["Alice", "terms:Bob=2,Carol=2"],
      // Polling: casting rewinds the impulse each time.
      ["Alice", "vote:caller:for"],
      ["Alice", "vote:V1:for"],
      ["Alice", "pass"],
      ["Bob", "vote:W:against"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ passed: true, votesFor: 3, votesAgainst: 1 });
    expect(state.seats[1]!.pool).toBe(8);
    expect(state.seats[2]!.pool).toBe(8);
    expect(alice.pool).toBe(10);
    expect(state.eventLog.some((e) => e.type === "CardBurned" && e.cardId === "krc1")).toBe(true);
    expect(alice.minions[0]!.locked).toBe(true); // political action locked V1
  });

  it("a tie fails and nothing burns", () => {
    const state = threeSeatGame();
    state.seats[1]!.minions.find((x) => x.id === "W")!.title = "primogen";
    state.seats[0]!.hand.push({ id: "krc1", name: "Kine Resources Contested" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...politicalActionTrace("play:Kine Resources Contested"),
      ["Alice", "terms:Bob=2,Carol=2"],
      ["Alice", "vote:caller:for"], // 1 for
      ["Alice", "pass"],
      ["Bob", "vote:W:against"], // 1 against → tie
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ passed: false, votesFor: 1, votesAgainst: 1 });
    expect(state.seats[1]!.pool).toBe(10);
    expect(state.seats[2]!.pool).toBe(10);
  });

  it("the Edge burns for a vote, and one political card per Methuselah may be burned", () => {
    const state = threeSeatGame();
    state.edge = "Carol";
    const bob = state.seats[1]!;
    bob.hand.push({ id: "pol1", name: "Anarchist Uprising" });
    bob.hand.push({ id: "pol2", name: "Domain Challenge" });
    state.seats[0]!.hand.push({ id: "krc1", name: "Kine Resources Contested" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...politicalActionTrace("play:Kine Resources Contested"),
      ["Alice", "terms:Bob=2,Carol=2"],
      ["Alice", "vote:caller:for"],
      ["Alice", "pass"],
      ["Bob", "vote:card:pol1:against"],
    ]);

    // Bob's card-vote allowance is spent: pol2 offers no vote.
    const bobAgain = engine.decision()!;
    expect(bobAgain.seat).toBe("Alice"); // casting rewound to the caller
    runTrace(engine, [["Alice", "pass"]]);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.startsWith("vote:card:pol2"))).toBe(false);

    runTrace(engine, [
      ["Bob", "pass"],
      ["Carol", "vote:edge:against"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(state.edge).toBeNull(); // burned, back to the center
    expect(state.eventLog.some((e) => e.type === "CardBurned" && e.cardId === "pol1")).toBe(true);
    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ passed: false, votesFor: 1, votesAgainst: 2 });
  });
});

describe("political action legality", () => {
  it("one political action per vampire per turn; allies never", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.calledPoliticalThisTurn = true;
    alice.hand.push({ id: "krc1", name: "Kine Resources Contested" });
    const engine = new VtesEngine(state, testRegistry);
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Kine"))).toBe(false);
  });

  it("a blocked political action burns the card and calls no referendum", () => {
    const state = threeSeatGame();
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.attached.push(entry("sb1", "Sport Bike", { statics: { intercept: 1 } }));
    state.seats[0]!.hand.push({ id: "krc1", name: "Kine Resources Contested" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Kine Resources Contested"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // → blocked
      // Combat V1 vs M, one uneventful round.
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(state.eventLog.some((e) => e.type === "ReferendumCalled")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "CardBurned" && e.cardId === "krc1")).toBe(true);
  });
});

describe("terms-less referendums (Anarchist Uprising 100059 / Domain Challenge 100570)", () => {
  it("Anarchist Uprising burns 1 pool per controlled minion, everyone included", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "au1", name: "Anarchist Uprising" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...politicalActionTrace("play:Anarchist Uprising"),
      // No terms — straight to polling.
      ["Alice", "vote:caller:for"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(state.seats[0]!.pool).toBe(9); // 1 minion
    expect(state.seats[1]!.pool).toBe(8); // 2 minions
    expect(state.seats[2]!.pool).toBe(9); // 1 minion
  });

  it("Domain Challenge counts only locked minions", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "dc1", name: "Domain Challenge" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...politicalActionTrace("play:Domain Challenge"),
      ["Alice", "vote:caller:for"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    // Only V1 is locked (it took the political action itself).
    expect(state.seats[0]!.pool).toBe(9);
    expect(state.seats[1]!.pool).toBe(10);
    expect(state.seats[2]!.pool).toBe(10);
  });
});

describe("Conservative Agitation (100414)", () => {
  it("allocates X = number of Methuselahs among two or more", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "ca1", name: "Conservative Agitation" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...politicalActionTrace("play:Conservative Agitation"),
      ["Alice", "terms:Bob=2,Carol=1"], // X = 3 seats
      ["Alice", "vote:caller:for"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(state.seats[1]!.pool).toBe(8);
    expect(state.seats[2]!.pool).toBe(9);
  });
});

describe("Neonate Breach (101271)", () => {
  it("burns 1, plus 3 when the chosen Methuselah controls a ready small vampire", () => {
    const state = threeSeatGame();
    state.seats[1]!.minions.find((x) => x.id === "M")!.capacity = 3;
    state.seats[0]!.hand.push({ id: "nb1", name: "Neonate Breach" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...politicalActionTrace("play:Neonate Breach"),
      ["Alice", "terms:Bob,Carol"],
      ["Alice", "vote:caller:for"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(state.seats[1]!.pool).toBe(6); // 1 + 3 (M has capacity 3)
    expect(state.seats[2]!.pool).toBe(9); // 1 (no small vampire)
  });
});

describe("Parity Shift (101353)", () => {
  it("requires a prince or justicar", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "ps1", name: "Parity Shift" });
    const engine = new VtesEngine(state, testRegistry);
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Parity Shift"))).toBe(false);

    state.seats[0]!.minions[0]!.title = "prince";
    const dp2 = engine.decision()!;
    expect(dp2.options.some((o) => o.id.startsWith("play:Parity Shift"))).toBe(true);
  });

  it("moves 3 pool from a richer Methuselah as allocated", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.title = "prince";
    state.seats[1]!.pool = 14;
    alice.hand.push({ id: "ps1", name: "Parity Shift" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...politicalActionTrace("play:Parity Shift"),
      ["Alice", "terms:Bob:Alice=3"],
      ["Alice", "vote:caller:for"],
      ["Alice", "vote:V1:for"], // prince: 2 more
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(state.seats[1]!.pool).toBe(11);
    expect(alice.pool).toBe(13);
  });
});

describe("Banishment (100131)", () => {
  it("moves a ready younger vampire to its controller's uncontrolled region", () => {
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    bob.minions.find((x) => x.id === "M")!.capacity = 3; // younger than V1 (5)
    state.seats[0]!.hand.push({ id: "ban1", name: "Banishment" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...politicalActionTrace("play:Banishment"),
      ["Alice", "terms:M"],
      ["Alice", "vote:caller:for"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(bob.minions.some((x) => x.id === "M")).toBe(false);
    const banished = bob.uncontrolled.find((u) => u.card.id === "M")!;
    expect(banished).toBeDefined();
    expect(banished.counters).toBe(2); // blood became counters
  });
});
