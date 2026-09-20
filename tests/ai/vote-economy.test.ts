/**
 * Not paying for votes that cannot matter
 * (docs/ai-vote-economy-design.md).
 *
 * Two halves, and they are separate because they fail differently:
 *
 *  1. the ENGINE decides whether the outcome is settled — "more for than
 *     against passes, ties fail" (p. 28) — which is arithmetic over
 *     public information, and the tie rule is the likeliest off-by-one;
 *  2. the POLICY refuses to pay into a settled one, and prices a toll
 *     even in a live one, which it did not read at all before.
 *
 * `decided` gates COSTS and never direction. A hand nobody can see can
 * grant votes during polling, so it has a known false-positive mode —
 * the tests assert the gating stays on the money side.
 */

import { describe, expect, it } from "vitest";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { VtesEngine } from "../../src/engine/engine.ts";
import { viewFor } from "../../src/engine/agent.ts";
import type { DecisionPoint, LegalOption } from "../../src/engine/options.ts";
import { newCycle } from "../../src/engine/state.ts";
import type { GameState, ReferendumFrame } from "../../src/engine/state.ts";
import { threeSeatGame } from "../engine/fixtures.ts";

const ME = "Alice";

function state(extra: Partial<ReferendumFrame> = {}): GameState {
  const s = threeSeatGame();
  s.frames.push({
    kind: "referendum",
    actionId: "a1",
    caller: "Carol",
    cardName: "Kine Resources Contested",
    variant: "political",
    bloodHuntTarget: null,
    callingMinion: null,
    voteGrants: {},
    effectKind: "burn",
    seatMap: { losers: { key: "alloc" } },
    step: "polling",
    // Aimed at Alice, so she wants it to FAIL.
    terms: { alloc: "Alice=4" },
    votes: [],
    usedSources: [],
    cycle: newCycle(["Carol", "Alice", "Bob"]),
    ...extra,
  });
  return s;
}

/** A tolled vote — Alexander Silverson's "burn 1 blood to vote against". */
function tolled(decided?: "pass" | "fail"): LegalOption[] {
  return [
    { id: "pass", kind: "pass", label: "pass" },
    {
      id: "vote:V1:against",
      kind: "castVote",
      label: "against",
      source: "V1",
      count: 2,
      inFavor: false,
      toll: 1,
      ...(decided ? { decided } : {}),
    },
    {
      id: "vote:V1:for",
      kind: "castVote",
      label: "for",
      source: "V1",
      count: 2,
      inFavor: true,
      ...(decided ? { decided } : {}),
    },
  ];
}

function decide(s: GameState, options: LegalOption[]): string {
  const dp: DecisionPoint = { seq: 1, seat: ME, window: "referendum.polling", options };
  return new HeuristicAgent({ seed: 5 }).decide(dp, options, viewFor(s, ME));
}

describe("the policy refuses to pay into a settled referendum", () => {
  it("pays the toll while the outcome is still live", () => {
    // Aimed at Alice, so voting against is worth real value and a point
    // of blood is a price worth paying.
    expect(decide(state(), tolled())).toBe("vote:V1:against");
  });

  it("will NOT pay it once the outcome is decided", () => {
    expect(decide(state(), tolled("pass"))).toBe("pass");
    expect(decide(state(), tolled("fail"))).toBe("pass");
  });

  it("still votes FREELY in a decided referendum", () => {
    // The gate is on the money, not on the vote. An untolled source costs
    // nothing, so there is no reason to withhold it — and `decided` is
    // not reliable enough to be trusted with direction.
    const free: LegalOption[] = [
      { id: "pass", kind: "pass", label: "pass" },
      {
        id: "vote:V1:against",
        kind: "castVote",
        label: "a",
        source: "V1",
        count: 2,
        inFavor: false,
        decided: "pass",
      },
      {
        id: "vote:V1:for",
        kind: "castVote",
        label: "f",
        source: "V1",
        count: 2,
        inFavor: true,
        decided: "pass",
      },
    ];
    expect(decide(state(), free)).toBe("vote:V1:against");
  });

  it("prefers the FREE source over the tolled one when both push its way", () => {
    const both: LegalOption[] = [
      { id: "pass", kind: "pass", label: "pass" },
      {
        id: "vote:V1:against",
        kind: "castVote",
        label: "a",
        source: "V1",
        count: 2,
        inFavor: false,
        toll: 1,
      },
      { id: "vote:V1:for", kind: "castVote", label: "f", source: "V1", count: 2, inFavor: true },
      {
        id: "vote:edge:against",
        kind: "castVote",
        label: "a",
        source: "edge",
        count: 2,
        inFavor: false,
      },
      { id: "vote:edge:for", kind: "castVote", label: "f", source: "edge", count: 2, inFavor: true },
    ];
    expect(decide(state(), both)).toBe("vote:edge:against");
  });

  it("does not let the toll flip the DIRECTION of a vote", () => {
    // A toll makes a vote cost more; it must not make the bot vote for a
    // referendum that burns its own pool. The value at stake (4 pool off
    // Alice) dwarfs a point of blood.
    expect(decide(state(), tolled())).toBe("vote:V1:against");
  });
});

describe("the engine's arithmetic, and the tie rule", () => {
  // A FIXTURE A TEST NEEDS, THE TEST BUILDS — and this one took two goes,
  // both of which were the fixture rather than the code:
  //
  //  - p. 28 lets a Methuselah vote with a political action card FROM
  //    HAND, so full hands alone keep every position live;
  //  - **the CALLER keeps their calling card's own vote** until they
  //    spend it, so a 3–3 tie is genuinely still live — the caller can
  //    break it. That is correct, and it is why `usedSources` has to say
  //    the caller has already voted before the tie rule can bite at all.
  const engine = (frame: Partial<ReferendumFrame>): VtesEngine => {
    const s = state({ usedSources: ["caller"], ...frame });
    s.edge = null;
    for (const seat of s.seats) seat.hand = [];
    return new VtesEngine(s, buildHandlerRegistry());
  };
  const decidedOf = (votes: ReferendumFrame["votes"]): "pass" | "fail" | null => {
    const e = engine({ votes });
    const rf = e.state.frames.find((f) => f.kind === "referendum") as ReferendumFrame;
    return e.referendumDecided(rf);
  };

  it("A TIE FAILS (p. 28), and is not reported as a pass", () => {
    expect(
      decidedOf([
        { seat: "Carol", source: "c1", count: 3, inFavor: true },
        { seat: "Alice", source: "a1", count: 3, inFavor: false },
      ]),
    ).toBe("fail");
  });

  it("is LIVE at the same tie while the caller can still break it", () => {
    // The same 3–3, with the caller's own calling-card vote unspent. One
    // vote is all it takes, so this is not settled — and calling it
    // settled would have the bot decline to pay for the vote that
    // decides the referendum.
    const s = state({ votes: [
      { seat: "Carol", source: "c1", count: 3, inFavor: true },
      { seat: "Alice", source: "a1", count: 3, inFavor: false },
    ] });
    s.edge = null;
    for (const seat of s.seats) seat.hand = [];
    const e = new VtesEngine(s, buildHandlerRegistry());
    const rf = e.state.frames.find((f) => f.kind === "referendum") as ReferendumFrame;
    expect(e.referendumDecided(rf)).toBeNull();
  });

  it("calls it a pass only on MORE for than against", () => {
    expect(
      decidedOf([
        { seat: "Carol", source: "c1", count: 4, inFavor: true },
        { seat: "Alice", source: "a1", count: 3, inFavor: false },
      ]),
    ).toBe("pass");
  });

  it("reports FAIL at 0–0 when nothing can be cast, which is the rule", () => {
    // 0–0 is a tie and a tie fails, so with no source left on the table
    // this really is settled. It reads oddly and it is correct — the
    // reason it never fires in a real game is that the caller always has
    // at least their own calling-card vote available, which makes the
    // position live. Asserted so the oddity is a decision on record
    // rather than something a later reader "fixes".
    expect(decidedOf([])).toBe("fail");
  });
});

describe("the policy's use of it", () => {
  // Driven through the policy, because `referendumDecided` is private and
  // the behaviour under test is what reaches an agent.
  const buy = (decided?: "pass" | "fail"): LegalOption[] => [
    { id: "pass", kind: "pass", label: "pass" },
    {
      id: "vote:blood:V1:0:against",
      kind: "castVote",
      label: "buy",
      source: "blood:V1",
      count: 1,
      inFavor: false,
      toll: 1,
      tollFrom: "V1",
      ...(decided ? { decided } : {}),
    },
  ];

  it("buys a vote that can still change things", () => {
    expect(decide(state(), buy())).toBe("vote:blood:V1:0:against");
  });

  it("does not buy one that cannot", () => {
    expect(decide(state(), buy("fail"))).toBe("pass");
  });
});
