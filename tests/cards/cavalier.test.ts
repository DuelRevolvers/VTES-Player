/**
 * Cavalier (100310): "Archetype. Put this card on a vampire you control. Once
 * each turn, this vampire can burn 1 blood to unlock after performing a
 * successful action costing blood. A vampire can have only one archetype."
 */
import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { playedCardCostsBlood } from "../../src/cards/effects/compile.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("Cavalier (100310)", () => {
  it("is offered as an archetype on an own vampire, not on another Methuselah's", () => {
    const state = threeSeatGame();
    const turn = state.frames[0]! as any;
    turn.phase = "master";
    turn.masterActionsLeft = 1;
    state.seats[0]!.hand = [{ id: "cv", name: "Cavalier" }];
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((o) => o.startsWith("play:Cavalier") && o.includes(":V1:"))).toBe(true);
    expect(ids.some((o) => o.startsWith("play:Cavalier") && o.includes(":V2:"))).toBe(false);
  });

  it("'costing blood' is a property of the card played", () => {
    // A card with a printed blood cost qualifies; a built-in action has no card.
    expect(playedCardCostsBlood({ instance: { name: "Blood Feast" } }, testRegistry)).toBe(true);
    expect(playedCardCostsBlood({ instance: { name: "Cry Wolf" } }, testRegistry)).toBe(false);
    expect(playedCardCostsBlood(null, testRegistry)).toBe(false);
    expect(playedCardCostsBlood(undefined, testRegistry)).toBe(false);
  });
});
