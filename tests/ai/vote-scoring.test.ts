/**
 * How a bot votes (docs/ai-vote-scoring-design.md).
 *
 * The defect this replaces was total rather than partial: over 20 games
 * the policy cast **70 votes FOR and 0 AGAINST**, including on
 * referendums that burned its own pool, because `voteOwn` and
 * `voteAgainstOthers` were named for a condition — "is this MY
 * referendum" — that nothing in scope could evaluate.
 *
 * THE ASSERTION THAT MATTERS is the pair: the same card, the same seat,
 * aimed two different ways, must produce opposite votes. No setting of
 * the old weights could have passed it.
 */

import { describe, expect, it } from "vitest";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import { viewFor } from "../../src/engine/agent.ts";
import type { PlayerView as ViewOf } from "../../src/engine/agent.ts";
import type { DecisionPoint, LegalOption } from "../../src/engine/options.ts";
import { newCycle } from "../../src/engine/state.ts";
import type { GameState, ReferendumFrame } from "../../src/engine/state.ts";
import { threeSeatGame } from "../engine/fixtures.ts";

/** Seating in `threeSeatGame`: Alice's prey is Bob, her predator Carol. */
const ME = "Alice";

/** `omitSeatMap` builds a referendum whose terms name no seats at all —
 *  a title grant, or a card that charges the table from the board. */
function withReferendum(
  extra: Partial<ReferendumFrame>,
  pools?: Record<string, number>,
  opts: { omitSeatMap?: boolean } = {},
): GameState {
  const state = threeSeatGame();
  if (pools) {
    for (const s of state.seats) if (pools[s.id] !== undefined) s.pool = pools[s.id]!;
  }
  const frame: ReferendumFrame = {
    kind: "referendum",
    actionId: "a1",
    caller: "Carol",
    cardName: "Kine Resources Contested",
    variant: "political",
    bloodHuntTarget: null,
    callingMinion: "N",
    voteGrants: {},
    effectKind: "burn",
    ...(opts.omitSeatMap ? {} : { seatMap: { losers: { key: "alloc" } } }),
    step: "polling",
    terms: {},
    votes: [],
    usedSources: [],
    cycle: newCycle(["Carol", "Alice", "Bob"]),
    ...extra,
  };
  state.frames.push(frame);
  return state;
}

/** A normal two-way fork from one source. */
function fork(source = "V1", count = 1): LegalOption[] {
  return [
    { id: "pass", kind: "pass", label: "pass" },
    { id: `vote:${source}:for`, kind: "castVote", label: "for", source, count, inFavor: true },
    {
      id: `vote:${source}:against`,
      kind: "castVote",
      label: "against",
      source,
      count,
      inFavor: false,
    },
  ];
}

function decide(state: GameState, options: LegalOption[], seat = ME): string {
  const dp: DecisionPoint = { seq: 1, seat, window: "referendum.polling", options };
  return new HeuristicAgent({ seed: 7 }).decide(dp, options, viewFor(state, seat));
}

describe("voting on somebody else's referendum", () => {
  it("votes FOR a burn aimed at its prey", () => {
    // Bob is Alice's prey. Pool off him is pool off the seat she scores by
    // ousting.
    const state = withReferendum({ terms: { alloc: "Bob=4" } });
    expect(decide(state, fork())).toBe("vote:V1:for");
  });

  it("votes AGAINST the same card aimed at itself", () => {
    // SAME card, SAME seat, SAME weights — only the terms differ. This is
    // the pair the old code could not have passed under any tuning.
    const state = withReferendum({ terms: { alloc: "Alice=4" } });
    expect(decide(state, fork())).toBe("vote:V1:against");
  });

  it("votes AGAINST a burn aimed at nobody in particular but itself included", () => {
    const state = withReferendum({ terms: { alloc: "Alice=2,Bob=2" } });
    // Two points off the prey is good, two off itself is bad, and its own
    // pool is worth more to it than its prey's is.
    expect(decide(state, fork())).toBe("vote:V1:against");
  });

  it("votes FOR a GIFT to itself and AGAINST the same gift to its prey", () => {
    // Camarilla's Iron Fist's shape: the chosen seat gains.
    const mine = withReferendum({
      cardName: "Camarilla's Iron Fist",
      seatMap: { losers: { key: "alloc" }, gainers: { key: "chosen", each: 1 } },
      terms: { chosen: "Alice", alloc: "Carol=5" },
    });
    expect(decide(mine, fork())).toBe("vote:V1:for");

    const theirs = withReferendum({
      cardName: "Camarilla's Iron Fist",
      seatMap: { losers: { key: "alloc" }, gainers: { key: "chosen", each: 1 } },
      terms: { chosen: "Bob", alloc: "Carol=1" },
    });
    expect(decide(theirs, fork())).toBe("vote:V1:against");
  });

  it("gets PARITY SHIFT the right way round", () => {
    // The sign trap: "allocate 3 of THEIR pool" makes the CHOSEN seat the
    // loser and the allocated seats the gainers — the reverse of every
    // allocate-burn beside it. Chosen = Alice means Alice LOSES.
    const againstMe = withReferendum({
      cardName: "Parity Shift",
      seatMap: { losers: { key: "chosen", each: 3 }, gainers: { key: "alloc" } },
      terms: { chosen: "Alice", alloc: "Carol=3" },
    });
    expect(decide(againstMe, fork())).toBe("vote:V1:against");

    // And chosen = Bob (the prey) with Alice gaining is the best kind.
    const forMe = withReferendum({
      cardName: "Parity Shift",
      seatMap: { losers: { key: "chosen", each: 3 }, gainers: { key: "alloc" } },
      terms: { chosen: "Bob", alloc: "Alice=3" },
    });
    expect(decide(forMe, fork())).toBe("vote:V1:for");
  });
});

describe("the oust cliff", () => {
  it("votes FOR a referendum that would oust its prey", () => {
    // p. 44 and p. 36: the ousted seat's PREDATOR takes the victory point
    // and 6 pool, whatever caused the oust — and Alice is Bob's predator.
    const state = withReferendum({ terms: { alloc: "Bob=2" } }, { Bob: 2 });
    expect(decide(state, fork())).toBe("vote:V1:for");
  });

  it("votes AGAINST one that would oust ITSELF, even having called it", () => {
    const state = withReferendum(
      { caller: ME, callingMinion: "V1", terms: { alloc: "Alice=2" } },
      { Alice: 2 },
    );
    expect(decide(state, fork())).toBe("vote:V1:against");
  });

  it("is not bought off by a gift attached to the same referendum", () => {
    // Camarilla's Iron Fist's shape aimed at one seat both ways: Alice is
    // the chosen beneficiary (+1) AND carries 4 of the allocation, on 3
    // pool. Net −3 takes her to exactly 0, which is ousted (p. 43) — and
    // the cliff has to read the NET, not the first term it meets.
    const state = withReferendum(
      {
        seatMap: { losers: { key: "alloc" }, gainers: { key: "chosen", each: 1 } },
        terms: { chosen: "Alice", alloc: "Alice=4" },
      },
      { Alice: 3 },
    );
    expect(decide(state, fork())).toBe("vote:V1:against");
  });

  it("does NOT fire the cliff when the gift outweighs the burn", () => {
    // The mirror, and the reason the one above is about the net: +5 for
    // being chosen against 3 allocated leaves Alice better off, so there
    // is no oust and nothing to guard against.
    const state = withReferendum(
      {
        seatMap: { losers: { key: "alloc" }, gainers: { key: "chosen", each: 5 } },
        terms: { chosen: "Alice", alloc: "Alice=3" },
      },
      { Alice: 3 },
    );
    expect(decide(state, fork())).toBe("vote:V1:for");
  });
});

describe("its own referendum", () => {
  it("supports one whose effect it cannot price", () => {
    // A title grant: nothing in the terms names a seat, so there is no
    // arithmetic — but it paid a card and an action for this.
    const state = withReferendum({
      caller: ME,
      callingMinion: "V1",
      cardName: "Ventrue Justicar",
      effectKind: "other",
      terms: {},
    }, undefined, { omitSeatMap: true });
    expect(decide(state, fork())).toBe("vote:V1:for");
  });

  it("votes AGAINST a rival's referendum it cannot price", () => {
    // The weak prior, and the one that keeps the bots taking part rather
    // than abstaining from every title grant.
    const state = withReferendum({
      cardName: "Ventrue Justicar",
      effectKind: "other",
      terms: {},
    }, undefined, { omitSeatMap: true });
    expect(decide(state, fork())).toBe("vote:V1:against");
  });

  it("will vote AGAINST ITS OWN referendum when the terms turned out badly", () => {
    // A real VTES play, and the `voteOwn` bias is deliberately too small
    // to stop it: the pool arithmetic outranks it.
    const state = withReferendum({
      caller: ME,
      callingMinion: "V1",
      terms: { alloc: "Alice=4" },
    });
    expect(decide(state, fork())).toBe("vote:V1:against");
  });
});

describe("a blood hunt is priced by whose vampire it is", () => {
  it("votes AGAINST burning its own", () => {
    const state = withReferendum({
      variant: "bloodHunt",
      cardName: "",
      callingMinion: null,
      bloodHuntTarget: "V1",
      effectKind: "other",
      terms: {},
    }, undefined, { omitSeatMap: true });
    expect(decide(state, fork())).toBe("vote:V1:against");
  });

  it("votes FOR burning somebody else's", () => {
    const state = withReferendum({
      variant: "bloodHunt",
      cardName: "",
      callingMinion: null,
      bloodHuntTarget: "W",
      effectKind: "other",
      terms: {},
    }, undefined, { omitSeatMap: true });
    expect(decide(state, fork())).toBe("vote:V1:for");
  });
});

describe("a DIRECTED GRANT is cast-or-decline, not for-or-against", () => {
  // "+N votes AGAINST the referendum" (Protected District) may only be
  // cast that way (docs/polling-votes-design.md §3), so there is no
  // opposite option to compare against — and scoring it as half a fork
  // would compare it to `pass` by accident.
  const onlyAgainst: LegalOption[] = [
    { id: "pass", kind: "pass", label: "pass" },
    {
      id: "vote:grantAgainst:against",
      kind: "castVote",
      label: "against",
      source: "grantAgainst",
      count: 3,
      inFavor: false,
    },
  ];

  it("spends it when it pushes the way the bot wants", () => {
    // A burn aimed at Alice: she wants this to fail, and the grant can
    // only help it fail.
    const state = withReferendum({ terms: { alloc: "Alice=4" } });
    expect(decide(state, onlyAgainst)).toBe("vote:grantAgainst:against");
  });

  it("LEAVES IT UNSPENT when it would push the wrong way", () => {
    // A burn aimed at Alice's prey: she wants this to PASS, and the only
    // thing this source can do is oppose it. Declining is free.
    const state = withReferendum({ terms: { alloc: "Bob=4" } });
    expect(decide(state, onlyAgainst)).toBe("pass");
  });
});

describe("the whole-table guard", () => {
  it("no longer votes one way for everything", async () => {
    // The regression this file exists for. Before item 3 the split over 20
    // games was FOR 70, AGAINST 0 — a degenerate policy that no scenario
    // test would have caught, because each individual vote looked like a
    // choice. Asserting BOTH directions occur pins the property rather
    // than a count, so a card wave cannot quietly restore the old
    // behaviour (docs/ai-vote-scoring-design.md §5).
    const { readFile } = await import("node:fs/promises");
    const { runBatch } = await import("../../src/ai/batch.ts");
    const { buildHandlerRegistry } = await import("../../src/cards/effects/cards.ts");
    const { buildGame } = await import("../../src/ui/decks.ts");
    type Cfg = { decks: Parameters<typeof buildGame>[0]["decks"]; maxTurns: number | null };
    const cfg = JSON.parse(
      await readFile("config/playtest-decks-politics.json", "utf-8"),
    ) as Cfg;

    let forVotes = 0;
    let againstVotes = 0;
    class Probe extends HeuristicAgent {
      override decide(dp: DecisionPoint, options: LegalOption[], view: ViewOf): string {
        const id = super.decide(dp, options, view);
        const chosen = options.find((o) => o.id === id);
        if (chosen?.kind === "castVote") {
          if (chosen.inFavor) forVotes++;
          else againstVotes++;
        }
        return id;
      }
    }
    const seats = cfg.decks.map((d) => d.seat);
    runBatch({
      games: 4,
      seed: 1,
      registry: buildHandlerRegistry(),
      buildState: (s) => buildGame({ decks: cfg.decks, seed: s, maxTurns: cfg.maxTurns ?? 40 }),
      agents: (s) => {
        const out: Record<string, HeuristicAgent> = {};
        seats.forEach((id, i) => {
          out[id] = new Probe({ seed: s * 1000 + i });
        });
        return out;
      },
    });

    expect(forVotes).toBeGreaterThan(0);
    expect(againstVotes).toBeGreaterThan(0);
  });
});

describe("negative space", () => {
  it("still votes when no referendum is projected at all", () => {
    // An older view, or a granted referendum that declared nothing. The
    // policy must not throw and must not abstain from everything.
    const state = threeSeatGame();
    const chosen = decide(state, fork());
    expect(["vote:V1:for", "vote:V1:against"]).toContain(chosen);
  });

  it("prefers the source with more votes, all else equal", () => {
    const state = withReferendum({ terms: { alloc: "Bob=4" } });
    const options: LegalOption[] = [
      { id: "pass", kind: "pass", label: "pass" },
      { id: "vote:V1:for", kind: "castVote", label: "f", source: "V1", count: 1, inFavor: true },
      { id: "vote:V1:against", kind: "castVote", label: "a", source: "V1", count: 1, inFavor: false },
      { id: "vote:edge:for", kind: "castVote", label: "f", source: "edge", count: 4, inFavor: true },
      {
        id: "vote:edge:against",
        kind: "castVote",
        label: "a",
        source: "edge",
        count: 4,
        inFavor: false,
      },
    ];
    expect(decide(state, options)).toBe("vote:edge:for");
  });
});
