/**
 * The clan Justicars (docs/justicars-design.md).
 *
 * Eight cards from one table. The tests here are about the three things
 * that differ or were missing, not about repeating one card eight times:
 * the Camarilla clause four of them print, the in-referendum vote bonus,
 * and `isUnique` — which the two Justicars already in the pool were
 * shipped without.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import { cardSpecs } from "../../src/cards/effects/cards.ts";

const politicalTrace = (prefix: string): Array<[string, string]> => [
  ["Alice", prefix],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
];

describe("every Justicar is unique", () => {
  it("carries `unique` on the spec, which is what the card contest reads", () => {
    const js = cardSpecs.filter((s) => s.name.endsWith(" Justicar"));
    expect(js.length).toBe(8);
    // Malkavian and Toreador were in the pool WITHOUT this since wave 13
    // (docs/justicars-design.md §3), so it is pinned by name.
    for (const s of js) expect([s.name, s.unique]).toEqual([s.name, true]);
  });
});

describe("Ventrue Justicar (102111)", () => {
  it("grants the title to a chosen Ventrue and gives every Ventrue +1 vote", () => {
    const state = threeSeatGame();
    // An UNTITLED Ventrue: the one vote Alice casts can then only be the
    // card's own rider, which is what makes the assertion mean something.
    Object.assign(state.seats[0]!.minions[0]!, {
      clan: "Ventrue",
      sect: "camarilla",
      capacity: 6,
    });
    state.seats[0]!.hand.push({ id: "vj", name: "Ventrue Justicar" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...politicalTrace("play:Ventrue Justicar"),
      ["Alice", "terms:V1"],
      ["Alice", "vote:grant:for"], // the rider's vote: V1 has no title of its own
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ passed: true, votesFor: 1 });
    expect(state.seats[0]!.minions[0]!.title).toBe("justicar");
  });
});

describe("the Camarilla clause", () => {
  it("Lasombra Justicar offers only a CAMARILLA Lasombra as its target", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { clan: "Lasombra", sect: "camarilla" });
    Object.assign(state.seats[1]!.minions[0]!, { clan: "Lasombra", sect: "sabbat" });
    state.seats[0]!.hand.push({ id: "lj", name: "Lasombra Justicar" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, politicalTrace("play:Lasombra Justicar"));

    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids).toContain("terms:V1");
    expect(ids).not.toContain("terms:W"); // Sabbat Lasombra
  });

  it("Tremere Justicar does not print it, so a Sabbat Tremere qualifies", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { clan: "Tremere", sect: "camarilla" });
    Object.assign(state.seats[1]!.minions[0]!, { clan: "Tremere", sect: "sabbat" });
    state.seats[0]!.hand.push({ id: "tj", name: "Tremere Justicar" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, politicalTrace("play:Tremere Justicar"));

    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids).toContain("terms:V1");
    expect(ids).toContain("terms:W");
  });
});
