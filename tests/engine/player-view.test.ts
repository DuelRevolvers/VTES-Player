/**
 * The hidden-information boundary (architecture principle 5).
 *
 * `viewFor(state, seat)` is what a seat may legitimately see, and phase 6
 * sends exactly this over the wire — so a leak here is a cheating vector,
 * not a cosmetic bug. Rulebook citations for each zone are in the test.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { viewFor } from "../../src/engine/index.ts";
import { makeMinion, threeSeatGame } from "./fixtures.ts";

/** Alice and Bob each get a hand, an uncontrolled vampire, a crypt pile and
 *  a card in play. */
function populated(): GameState {
  const state = threeSeatGame();
  for (const [i, seat] of state.seats.entries()) {
    seat.hand = [
      { id: `${seat.id}-h1`, name: "Govern the Unaligned" },
      { id: `${seat.id}-h2`, name: "Conditioning" },
    ];
    seat.library = [{ id: `${seat.id}-l1`, name: "Blood Doll" }];
    seat.uncontrolled = [
      { card: makeMinion(`${seat.id}-u`, seat.id, { capacity: 6 }), counters: 2 + i },
    ];
    seat.crypt = [makeMinion(`${seat.id}-c`, seat.id)];
    seat.permanents = [
      {
        card: { id: `${seat.id}-p`, name: "The Barrens" },
        locked: false,
        usedThisPhase: false,
        statics: {},
        tags: [],
      },
    ];
  }
  return state;
}

describe("viewFor — the hidden-information boundary", () => {
  it("shows your own hand and hides everyone else's", () => {
    const view = viewFor(populated(), "Alice");
    const alice = view.seats.find((s) => s.id === "Alice")!;
    const bob = view.seats.find((s) => s.id === "Bob")!;

    expect(Array.isArray(alice.hand)).toBe(true);
    expect(alice.hand).toHaveLength(2);
    // Another Methuselah's hand is a count, with no card names anywhere.
    expect(Array.isArray(bob.hand)).toBe(false);
    // A count, plus the cards this viewer has been SHOWN — empty here,
    // because nothing has revealed anything (docs/knowledge-design.md).
    expect(bob.hand).toEqual({ count: 2, known: [] });
    expect(JSON.stringify(bob)).not.toContain("Conditioning");
  });

  it("hides another Methuselah's uncontrolled region but shows its counters", () => {
    // p. 14: crypt cards are dealt FACE DOWN into the uncontrolled region,
    // and "you can look at the cards in your hand and in your uncontrolled
    // region" — your own only. A vampire turns face up when it moves to the
    // ready region (p. 36). The blood counters stacked on a face-down card
    // are still visible on the table, so the count is public.
    const view = viewFor(populated(), "Alice");
    const alice = view.seats.find((s) => s.id === "Alice")!;
    const bob = view.seats.find((s) => s.id === "Bob")!;

    expect(alice.uncontrolled[0]!.card).not.toBeNull();
    expect(alice.uncontrolled[0]!.card!.id).toBe("Alice-u");

    expect(bob.uncontrolled[0]!.card).toBeNull();
    expect(bob.uncontrolled[0]!.counters).toBe(3);
    expect(JSON.stringify(bob.uncontrolled)).not.toContain("Bob-u");
  });

  it("shows every Methuselah's cards in play — they are face up", () => {
    const view = viewFor(populated(), "Alice");
    for (const seat of view.seats) {
      expect(seat.permanents).toHaveLength(1);
      expect(seat.permanents[0]!.card.name).toBe("The Barrens");
    }
  });

  it("shows minions for everyone — ready and torpor are face up", () => {
    const state = populated();
    state.seats[1]!.minions[0]!.inTorpor = true;
    const view = viewFor(state, "Alice");
    const bob = view.seats.find((s) => s.id === "Bob")!;
    expect(bob.minions.length).toBeGreaterThan(0);
    expect(bob.minions.some((m) => m.inTorpor)).toBe(true);
  });

  it("reduces every draw pile to a count, including your own", () => {
    // Your own library is face down too — you may not read your deck.
    const view = viewFor(populated(), "Alice");
    for (const seat of view.seats) {
      expect(seat.libraryCount).toBe(1);
      expect(seat.cryptCount).toBe(1);
    }
    expect(JSON.stringify(view)).not.toContain("Blood Doll");
    expect(JSON.stringify(view)).not.toContain("Alice-c");
  });

  it("leaks no card name that the seat may not see, anywhere in the view", () => {
    // A blunt whole-document check: the only card names in Alice's view
    // should be her own hand plus public cards in play.
    const view = viewFor(populated(), "Alice");
    const json = JSON.stringify(view);
    expect(json).toContain("Govern the Unaligned"); // her own hand
    expect(json).toContain("The Barrens"); // public, in play
    expect(json).not.toContain("Bob-h1");
    expect(json).not.toContain("Bob-u");
    expect(json).not.toContain("Bob-c");
    expect(json).not.toContain("Carol-h1");
  });
});
