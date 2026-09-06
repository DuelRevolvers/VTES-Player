/**
 * Politics follow-ups gate (docs/politics-followups-design.md):
 * title-granting referendums (Toreador Justicar) that set MinionState.title
 * and attach the card on a pass, and per-clan vote statics (Power
 * Structure) that grant one vote per controlled clan vampire.
 */

import { describe, expect, it } from "vitest";
import type { PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function permanent(id: string, name: string): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [] };
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

describe("Toreador Justicar (101990) — title-granting referendum", () => {
  it("sets the chosen Toreador's title and attaches the card on a pass", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.title = "prince"; // 2 votes for the caller
    v1.clan = "Toreador";
    v1.sect = "camarilla";
    // A second ready Toreador is the title target.
    state.seats[0]!.minions.push(
      makeMinion("V2", "Alice", { clan: "Toreador", sect: "camarilla" }),
    );
    state.seats[0]!.hand.push({ id: "tj1", name: "Toreador Justicar" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...politicalActionTrace("play:Toreador Justicar"),
      ["Alice", "terms:V2"], // grant the title to V2
      ["Alice", "vote:V1:for"], // 2 votes for
      ["Alice", "pass"],
      ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ passed: true });
    const v2 = state.seats[0]!.minions.find((m) => m.id === "V2")!;
    expect(v2.title).toBe("justicar");
    expect(v2.attached.some((p) => p.card.name === "Toreador Justicar")).toBe(true);
    // The card is on the vampire, not burned.
    expect(state.eventLog.some((e) => e.type === "CardBurned" && e.cardId === "tj1")).toBe(false);
  });

  it("burns the card and grants no title when the referendum fails", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.clan = "Toreador";
    v1.sect = "camarilla";
    state.seats[0]!.minions.push(
      makeMinion("V2", "Alice", { clan: "Toreador", sect: "camarilla" }),
    );
    // Bob has a prince to vote against.
    state.seats[1]!.minions.find((x) => x.id === "W")!.title = "prince";
    state.seats[0]!.hand.push({ id: "tj1", name: "Toreador Justicar" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...politicalActionTrace("play:Toreador Justicar"),
      ["Alice", "terms:V2"],
      // Caller has no titled vampire; only the +1 Toreador grant votes (2).
      ["Alice", "vote:grant:for"], // 2 for
      ["Alice", "pass"],
      ["Bob", "vote:W:against"], // 2 against → tie fails
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ passed: false });
    const v2 = state.seats[0]!.minions.find((m) => m.id === "V2")!;
    expect(v2.title).toBeNull();
    expect(state.eventLog.some((e) => e.type === "CardBurned" && e.cardId === "tj1")).toBe(true);
  });
});

describe("Power Structure (101430) — per-clan vote static", () => {
  it("locks during polling for one vote per controlled Lasombra", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.clan = "Lasombra";
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { clan: "Lasombra" }));
    state.seats[0]!.permanents.push(permanent("ps1", "Power Structure"));
    state.seats[0]!.hand.push({ id: "krc1", name: "Kine Resources Contested" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...politicalActionTrace("play:Kine Resources Contested"),
      ["Alice", "terms:Bob=2,Carol=2"],
      ["Alice", "ability:Power Structure:ps1:votes"], // +2 (two Lasombra)
      ["Alice", "vote:grant:for"], // cast the 2 granted votes
      ["Alice", "pass"],
      ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ passed: true, votesFor: 2 });
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "ps1")!.locked).toBe(true);
  });
});
