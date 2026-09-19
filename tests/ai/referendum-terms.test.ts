/**
 * Where a bot aims its own referendum
 * (docs/ai-referendum-terms-design.md).
 *
 * Terms are chosen on success only (p. 25's one exception, p. 27), so
 * this decision is reached exactly when the card, the action and the
 * referendum have all already been paid for. **It is the payload**, and
 * it used to be answered in offered order — a bot that landed Parity
 * Shift picked its victim by coin flip.
 *
 * The rotation tests are the ones that matter: an aim that follows the
 * PREY rather than a seat name is the difference between a scorer and a
 * fixture that happens to be ordered conveniently.
 */

import { describe, expect, it } from "vitest";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import { viewFor } from "../../src/engine/agent.ts";
import type { DecisionPoint, LegalOption } from "../../src/engine/options.ts";
import { newCycle, resolvePerSeat } from "../../src/engine/state.ts";
import type { GameState, ReferendumFrame } from "../../src/engine/state.ts";
import { threeSeatGame } from "../engine/fixtures.ts";

/** Seating in `threeSeatGame`: Alice's prey is Bob, her predator Carol. */
const SEAT_MAP = { losers: { key: "alloc" } };

function callerState(caller: string, pools?: Record<string, number>): GameState {
  const state = threeSeatGame();
  if (pools) for (const s of state.seats) if (pools[s.id] !== undefined) s.pool = pools[s.id]!;
  const frame: ReferendumFrame = {
    kind: "referendum",
    actionId: "a1",
    caller,
    cardName: "Kine Resources Contested",
    variant: "political",
    bloodHuntTarget: null,
    callingMinion: null,
    voteGrants: {},
    effectKind: "burn",
    seatMap: SEAT_MAP,
    step: "terms",
    terms: {},
    votes: [],
    usedSources: [],
    cycle: newCycle([caller]),
  };
  state.frames.push(frame);
  return state;
}

/** Terms options as the engine builds them, priced the way the engine
 *  prices them — through the SAME helper, so this cannot drift from it. */
function termsOptions(
  allocations: string[],
  map: typeof SEAT_MAP | { losers?: { key: string; each?: number }; gainers?: { key: string; each?: number } } = SEAT_MAP,
): LegalOption[] {
  return allocations.map((alloc) => ({
    id: `terms:${alloc}`,
    kind: "chooseTerms" as const,
    label: alloc,
    params: { alloc },
    perSeat: resolvePerSeat({ alloc }, map),
  }));
}

function decide(state: GameState, options: LegalOption[], seat: string): string {
  const dp: DecisionPoint = { seq: 1, seat, window: "referendum.terms", options };
  return new HeuristicAgent({ seed: 3 }).decide(dp, options, viewFor(state, seat));
}

describe("aiming an allocation", () => {
  it("puts the whole burn on its PREY", () => {
    const state = callerState("Alice");
    const chosen = decide(state, termsOptions(["Alice=4", "Bob=4", "Carol=4"]), "Alice");
    expect(chosen).toBe("terms:Bob=4");
  });

  it("follows the prey when the seating rotates, not the seat name", () => {
    // Bob's prey is Carol. Same option list, different caller — if this
    // still said "Bob" the scorer would be reading the list order.
    const state = callerState("Bob");
    const chosen = decide(state, termsOptions(["Alice=4", "Bob=4", "Carol=4"]), "Bob");
    expect(chosen).toBe("terms:Carol=4");

    const third = callerState("Carol");
    expect(decide(third, termsOptions(["Alice=4", "Bob=4", "Carol=4"]), "Carol")).toBe(
      "terms:Alice=4",
    );
  });

  it("never aims it at itself when anything else is offered", () => {
    const state = callerState("Alice");
    for (const seat of ["Alice", "Bob", "Carol"]) {
      const s = callerState(seat);
      const chosen = decide(s, termsOptions(["Alice=4", "Bob=4", "Carol=4"]), seat);
      expect(chosen).not.toBe(`terms:${seat}=4`);
    }
    expect(decide(state, termsOptions(["Alice=4"]), "Alice")).toBe("terms:Alice=4");
  });

  it("prefers concentrating on the prey over spreading the same points", () => {
    const state = callerState("Alice");
    const chosen = decide(
      state,
      termsOptions(["Bob=4", "Bob=2,Carol=2", "Carol=4", "Bob=1,Carol=3"]),
      "Alice",
    );
    expect(chosen).toBe("terms:Bob=4");
  });

  it("prefers its PREDATOR to a cross-table seat when the prey is not offered", () => {
    // Four seats, so there is a genuine cross-table seat to lose to.
    const state = threeSeatGame();
    state.seats.push({
      ...structuredClone(state.seats[2]!),
      id: "Dave",
      minions: [],
      uncontrolled: [],
    });
    state.frames.push({
      kind: "referendum",
      actionId: "a1",
      caller: "Alice",
      cardName: "Kine Resources Contested",
      variant: "political",
      bloodHuntTarget: null,
      callingMinion: null,
      voteGrants: {},
      effectKind: "burn",
      seatMap: SEAT_MAP,
      step: "terms",
      terms: {},
      votes: [],
      usedSources: [],
      cycle: newCycle(["Alice"]),
    });
    // Alice: prey Bob, predator Dave, cross-table Carol. Bob is absent
    // from the list, so the predator should win over the cross seat.
    expect(decide(state, termsOptions(["Carol=4", "Dave=4"]), "Alice")).toBe("terms:Dave=4");
  });
});

describe("when it cannot avoid itself", () => {
  it("takes the SMALLEST share it can", () => {
    // Seen in a real game: a heads-up table, where Kine Resources
    // Contested's "allocate among two or more Methuselahs" forces the
    // caller to include themselves. The choice that remains is how much
    // of it they eat, and it is the only thing separating the options.
    const state = threeSeatGame();
    state.seats[2]!.ousted = true;
    state.frames.push({
      kind: "referendum",
      actionId: "a1",
      caller: "Alice",
      cardName: "Kine Resources Contested",
      variant: "political",
      bloodHuntTarget: null,
      callingMinion: null,
      voteGrants: {},
      effectKind: "burn",
      seatMap: SEAT_MAP,
      step: "terms",
      terms: {},
      votes: [],
      usedSources: [],
      cycle: newCycle(["Alice"]),
    });
    const chosen = decide(
      state,
      termsOptions(["Alice=3,Bob=1", "Alice=2,Bob=2", "Alice=1,Bob=3"]),
      "Alice",
    );
    expect(chosen).toBe("terms:Alice=1,Bob=3");
  });
});

describe("the oust cliff", () => {
  it("takes the kill on its prey over a bigger burn elsewhere", () => {
    // Bob on 2 pool: 2 points ousts him, which is a victory point and 6
    // pool for Alice (p. 44, p. 36). Four points on Carol is more pool
    // burned and worth far less.
    const state = callerState("Alice", { Bob: 2, Carol: 20 });
    expect(decide(state, termsOptions(["Bob=2,Carol=2", "Carol=4"]), "Alice")).toBe(
      "terms:Bob=2,Carol=2",
    );
  });
});

describe("PARITY SHIFT, whose signs are reversed", () => {
  const PARITY = { losers: { key: "chosen", each: 3 }, gainers: { key: "alloc" } };

  it("aims the LOSS at the prey and the GAIN at itself", () => {
    const state = callerState("Alice");
    const options: LegalOption[] = [
      { chosen: "Bob", alloc: "Alice=3" },
      { chosen: "Alice", alloc: "Bob=3" },
      { chosen: "Carol", alloc: "Bob=3" },
    ].map((params) => ({
      id: `terms:${params.chosen}:${params.alloc}`,
      kind: "chooseTerms" as const,
      label: "",
      params,
      perSeat: resolvePerSeat(params, PARITY),
    }));
    // Bob (prey) loses 3, Alice gains 3. The middle option is the exact
    // inversion and is what a generic `alloc`-means-loss parse would pick.
    expect(decide(state, options, "Alice")).toBe("terms:Bob:Alice=3");
  });
});

describe("negative space", () => {
  it("falls back to the tie-break for terms it cannot price", () => {
    // A clan, a location, a minion — no seat named, so no arithmetic.
    // This must score exactly as it used to rather than as zero, or an
    // unpriceable card becomes worse off than before.
    const state = callerState("Alice");
    const options: LegalOption[] = ["Brujah", "Ventrue", "Toreador"].map((clan) => ({
      id: `terms:${clan}`,
      kind: "chooseTerms" as const,
      label: clan,
      params: { clan },
    }));
    const chosen = decide(state, options, "Alice");
    expect(options.map((o) => o.id)).toContain(chosen);
  });

  it("does not throw when a named seat has left the table", () => {
    // A derived read must be TOTAL: a seat id can outlive the seat.
    const state = callerState("Alice");
    const chosen = decide(state, termsOptions(["Ghost=4", "Bob=4"]), "Alice");
    expect(chosen).toBe("terms:Bob=4");
  });
});
