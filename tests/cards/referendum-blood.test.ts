/**
 * Blood at the referendum (docs/referendum-blood-design.md).
 *
 * Mob Rule (101230), Rant! (101541), Cheval de Bataille (100337) — votes
 * bought with blood, and a tax on voting the wrong way.
 */

import { describe, expect, it } from "vitest";
import type { GameState, ReferendumFrame } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** A referendum on the stack, mid-polling, with the real cycle shape. */
function pushReferendum(state: GameState, over: Partial<ReferendumFrame> = {}): void {
  state.frames.push({
    kind: "referendum",
    variant: "political",
    caller: "Alice",
    callingMinion: "V1",
    cardName: "Anarchist Uprising",
    cardInstanceId: null,
    step: "polling",
    votes: [],
    usedSources: [],
    voteGrants: {},
    cycle: { order: ["Alice", "Bob", "Carol"], cursor: 0, passes: 0 },
    bloodHuntTarget: null,
    ...over,
  } as unknown as GameState["frames"][number]);
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function find(state: GameState, id: string) {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id)!;
}

// ---------------------------------------------------------------------------

describe("Mob Rule (101230)", () => {
  it("offers every qualifying vampire a repeatable blood-for-votes buy", () => {
    const state = threeSeatGame();
    find(state, "V1").capacity = 8; // above 7 — the second tier
    pushReferendum(state, {
      bloodVoteOffers: [
        { minCapacity: 4, votesPerBlood: 1, bigCapacity: 7, bigVotesPerBlood: 1 },
      ],
    } as Partial<ReferendumFrame>);
    const engine = new VtesEngine(state, testRegistry);
    const buy = optionIds(engine).find((i) => i.startsWith("vote:blood:V1:") && i.endsWith(":for"));
    expect(buy).toBeDefined();
    engine.choose(buy!);
    const rf = state.frames.find((f) => f.kind === "referendum")!;
    if (rf.kind !== "referendum") throw new Error("no referendum");
    expect(rf.votes.at(-1)).toMatchObject({ count: 2, inFavor: true });
    expect(find(state, "V1").blood).toBe(1); // started at 2
    // Repeatable: the buy is still on offer, because it spends blood and
    // not a vote SOURCE.
    expect(optionIds(engine).some((i) => i.startsWith("vote:blood:V1:") && i.endsWith(":for"))).toBe(true);
  });

  it("NEGATIVE SPACE: nothing for a vampire at the capacity floor", () => {
    const state = threeSeatGame();
    find(state, "V1").capacity = 4; // "above 4" is strict
    pushReferendum(state, {
      bloodVoteOffers: [{ minCapacity: 4, votesPerBlood: 1 }],
    } as Partial<ReferendumFrame>);
    const engine = new VtesEngine(state, testRegistry);
    expect(optionIds(engine).some((i) => i.startsWith("vote:blood:V1"))).toBe(false);
  });
});

describe("Cheval de Bataille (100337)", () => {
  it("charges the against-voters at the TALLY, including earlier votes", () => {
    const state = threeSeatGame();
    pushReferendum(state, {
      // A vote cast BEFORE the card was played [RTR 19951110].
      votes: [{ seat: "Bob", source: "W", count: 2, inFavor: false }],
      againstBloodTaxAtTally: 1,
      cycle: { order: ["Alice", "Bob", "Carol"], cursor: 0, passes: 3 },
    } as Partial<ReferendumFrame>);
    const before = find(state, "W").blood;
    const engine = new VtesEngine(state, testRegistry);
    engine.decision(); // drains the quiescent cycle into the tally
    expect(find(state, "W").blood).toBe(before - 1);
  });
});
