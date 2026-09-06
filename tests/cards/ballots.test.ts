/**
 * Ballots gate (docs/ballots-design.md): referendum-scoped restrictions on
 * which vampires may cast votes/ballots by sect — Closed Session
 * (non-Camarilla), Private Audience (non-Sabbat), and Cardinal
 * Benediction's non-Sabbat rider.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function politicalActionTrace(cardPrefix: string): Array<[string, string]> {
  return [
    ["Alice", cardPrefix],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ];
}

describe("Closed Session (100364) — non-Camarilla cannot cast votes", () => {
  it("removes a Sabbat vampire's vote option after the caller plays it", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.title = "prince";
    v1.sect = "camarilla";
    // Bob has a Sabbat archbishop (2 votes) that Closed Session shuts out.
    const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
    w.title = "archbishop";
    w.sect = "sabbat";
    state.seats[0]!.hand.push({ id: "krc1", name: "Kine Resources Contested" });
    state.seats[0]!.hand.push({ id: "cs1", name: "Closed Session" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...politicalActionTrace("play:Kine Resources Contested"),
      ["Alice", "terms:Bob=2,Carol=2"],
      ["Alice", "play:Closed Session:basic:V1"], // restrict to Camarilla
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // its as-played window
      ["Alice", "vote:V1:for"], // prince, 2 for
      ["Alice", "pass"],
    ]);

    // Bob is polled next: his Sabbat archbishop cannot cast.
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.startsWith("vote:W"))).toBe(false);

    runTrace(engine, [["Bob", "pass"], ["Carol", "pass"]]);
    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ passed: true, votesFor: 2, votesAgainst: 0 });
  });
});

describe("Cardinal Benediction (100294) — non-Sabbat cannot cast votes", () => {
  it("restricts voting to Sabbat and grants the cardinal title on a pass", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.title = "archbishop"; // 2 Sabbat votes for the caller
    v1.sect = "sabbat";
    v1.capacity = 7;
    // Bob has a Camarilla prince who is shut out by the Sabbat restriction.
    const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
    w.title = "prince";
    w.sect = "camarilla";
    state.seats[0]!.hand.push({ id: "cb1", name: "Cardinal Benediction" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...politicalActionTrace("play:Cardinal Benediction"),
      ["Alice", "terms:V1"], // grant the cardinal title to V1 itself
      ["Alice", "vote:V1:for"], // 2 Sabbat votes for
      ["Alice", "pass"],
    ]);

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.startsWith("vote:W"))).toBe(false); // non-Sabbat

    runTrace(engine, [["Bob", "pass"], ["Carol", "pass"]]);
    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ passed: true });
    expect(state.seats[0]!.minions[0]!.title).toBe("cardinal");
  });
});
