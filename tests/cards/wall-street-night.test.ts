/**
 * Wall Street Night, Financial Newspaper (102142) — an intercept location
 * gated to undirected actions, plus a granted action against *investment
 * cards*, of which the V5 pool contains none (this card is the only one
 * that mentions them). The second clause is written against an
 * "investment" tag so it enumerates nothing today and works the day such
 * a card exists.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function wallStreet(over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return {
    card: { id: "wsn", name: "Wall Street Night, Financial Newspaper" },
    controller: "Bob",
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["location"],
    ...over,
  };
}

/** Bob controls the location; Alice acts, Bob blocks with M. */
function game(): GameState {
  const state = threeSeatGame();
  state.seats[1]!.permanents.push(wallStreet());
  return state;
}

describe("Wall Street Night (102142) — the intercept clause", () => {
  it("is offered against an undirected action", () => {
    const state = game();
    // An undirected action: Alice's vampire hunts.
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:M"], // hunt has +1 stealth, so intercept is needed
      ["Alice", "pass"], // the block attempt's cycle reaches Bob next
    ]);

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(
      dp.options.some((o) => o.id === "ability:Wall Street Night, Financial Newspaper:wsn:intercept"),
    ).toBe(true);
  });

  it("is not offered against a directed action", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    // A bleed is directed at Bob (p. 25).
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
    ]);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.includes("Wall Street Night"))).toBe(false);
  });
});

describe("Wall Street Night (102142) — the investment clause", () => {
  it("offers nothing while no investment card is in play", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(wallStreet({ controller: "Alice" }));
    const dp = new VtesEngine(state, testRegistry).decision()!;

    expect(dp.seat).toBe("Alice");
    expect(dp.options.some((o) => o.id.includes("Wall Street Night"))).toBe(false);
  });

  it("takes a counter from an investment card as a directed action", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(wallStreet({ controller: "Alice" }));
    // Stand in for an investment card: any card in play carrying counters
    // and the tag. (No V5 card has it — see the file header.)
    state.seats[1]!.permanents.push({
      card: { id: "inv", name: "Dreams of the Sphinx" },
      controller: "Bob",
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["investment"],
      counters: 2,
    });
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(
      dp.options.some((o) => o.id === "act:Wall Street Night:wsn:invest:V1:inv"),
    ).toBe(true);

    runTrace(engine, [
      ["Alice", "act:Wall Street Night:wsn:invest:V1:inv"],
      // Directed at the investment card's controller (p. 25), so Bob is
      // the one who may block.
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // effects
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(state.seats[1]!.permanents.find((p) => p.card.id === "inv")?.counters).toBe(1);
    expect(state.seats[0]!.pool).toBe(11);
    // "Lock this location to attempt" — spent whether or not it resolved.
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "wsn")?.locked).toBe(true);
  });
});
