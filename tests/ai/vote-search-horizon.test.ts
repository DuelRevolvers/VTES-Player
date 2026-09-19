/**
 * The search agent evaluates a vote at the TALLY, not at the cast
 * (docs/ai-vote-search-horizon-design.md).
 *
 * Before this, `settle` treated only action, combat and cardPlay frames
 * as "in flight", so a referendum was not. A cast vote was therefore
 * evaluated one step after the cast — before polling closed and before
 * anything the referendum does had happened — so both directions valued
 * identically, the lookahead contributed exactly nothing, and the search
 * agent was the policy with the search's cost paid for nothing.
 *
 * The opponent model (owner ruling, 2026-09-19, option (c)) is the first
 * in this project, and the tests below pin the three properties that
 * make it legitimate rather than a peek.
 */

import { describe, expect, it } from "vitest";
import { SearchAgent } from "../../src/ai/search.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { VtesEngine } from "../../src/engine/engine.ts";
import { redactFor, viewFor } from "../../src/engine/agent.ts";
import type { DecisionPoint, LegalOption } from "../../src/engine/options.ts";
import { newCycle } from "../../src/engine/state.ts";
import type { GameState, ReferendumFrame } from "../../src/engine/state.ts";
import { threeSeatGame } from "../engine/fixtures.ts";

const ME = "Alice";

/**
 * A referendum mid-polling whose terms burn `victim`, with Alice to
 * decide and a REAL vote source of her own.
 *
 * The title is not decoration: without one Alice has no vote source, the
 * engine offers her no `castVote` at all, and a test that fabricated the
 * options would be simulating a decision the engine never raised —
 * `simulate` checks the cloned engine is offering the same decision and
 * bails otherwise, so the lookahead would silently contribute nothing.
 * The first version of this file did exactly that and passed anyway, on
 * the policy alone.
 */
function polling(victim: string, pools?: Record<string, number>): GameState {
  const state = threeSeatGame();
  state.seats[0]!.minions[0]!.title = "prince";
  if (pools) for (const s of state.seats) if (pools[s.id] !== undefined) s.pool = pools[s.id]!;
  const frame: ReferendumFrame = {
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
    terms: { alloc: `${victim}=4` },
    votes: [],
    usedSources: [],
    // Alice first, so the decision the engine raises is hers.
    cycle: newCycle([ME, "Bob", "Carol"]),
  };
  state.frames.push(frame);
  return state;
}

function agent(weights?: ConstructorParameters<typeof SearchAgent>[0]): SearchAgent {
  return new SearchAgent({ registry: buildHandlerRegistry(), seed: 3, ...weights });
}

/**
 * Ask the ENGINE for the decision rather than fabricating one.
 *
 * `simulate` refuses to search a decision the cloned engine is not also
 * offering — "or we would be searching a different game than the one
 * being played" — so a hand-built `DecisionPoint` makes the whole
 * lookahead a no-op and every assertion below a test of the policy.
 */
function realDecision(state: GameState): { dp: DecisionPoint; options: LegalOption[] } {
  const engine = new VtesEngine(state, buildHandlerRegistry());
  const dp = engine.decision();
  if (!dp) throw new Error("no decision offered");
  return { dp, options: dp.options };
}

function decide(state: GameState, a: SearchAgent = agent()): string {
  const { dp, options } = realDecision(state);
  return a.decide(dp, options, viewFor(state, ME), redactFor(state, ME));
}

/** The vote option in `options` going the given way. */
function voteId(options: LegalOption[], inFavor: boolean): string {
  const o = options.find((x) => x.kind === "castVote" && x.inFavor === inFavor);
  if (!o) throw new Error(`no ${inFavor ? "for" : "against"} vote offered`);
  return o.id;
}

describe("the mirrored pair", () => {
  it("votes FOR a referendum that burns its prey", () => {
    const state = polling("Bob");
    expect(decide(state)).toBe(voteId(realDecision(polling("Bob")).options, true));
  });

  it("votes AGAINST the same referendum aimed at itself", () => {
    const state = polling(ME);
    expect(decide(state)).toBe(voteId(realDecision(polling(ME)).options, false));
  });
});

describe("THE OPPONENT MODEL ACTUALLY RUNS", () => {
  // The mirrored pair above would pass with `lookahead: 0`, because the
  // POLICY learned to vote correctly in item 3 — so on its own it is a
  // test of the policy, not of the horizon. What has to be pinned is the
  // MECHANISM: that polling is driven to a tally, with other seats
  // voting, inside the simulation.
  it("casts votes for the other seats inside the simulation", () => {
    const a = agent();
    decide(polling("Bob"), a);
    expect(a.modelledVotes).toBeGreaterThan(0);
  });

  it("casts NONE when there is no referendum — the model is scoped to polling", () => {
    // The negative control, and it has to be a different POSITION rather
    // than a different weight: `lookahead: 0` still simulates (the term
    // is multiplied by zero afterwards), so switching it off would not
    // stop the modelling and a test built on that would assert nothing.
    const state = threeSeatGame();
    const engine = new VtesEngine(state, buildHandlerRegistry());
    const dp = engine.decision();
    expect(dp).not.toBeNull();
    const a = agent();
    a.decide(dp!, dp!.options, viewFor(state, dp!.seat), redactFor(state, dp!.seat));
    expect(a.simulationsRun).toBeGreaterThan(0);
    expect(a.modelledVotes).toBe(0);
  });

  /**
   * WHY THERE IS NO "crippled policy" TEST HERE, though the design doc
   * asked for one.
   *
   * The obvious version inverts the policy's vote weights so it votes
   * backwards, leans the blend on the search, and asserts the search
   * overrides it. It was written, and it does not isolate what it looks
   * like it isolates: **the policy and the opponent model are the same
   * object**, so crippling one cripples the other. The modelled Carol
   * then votes against her own referendum, Alice's vote stops mattering,
   * and the agent correctly passes — a green-looking failure that says
   * nothing about the horizon.
   *
   * Splitting them would mean giving the model its own weights, which
   * would be a second vote policy to keep in step. The counter above
   * tests the mechanism directly and costs nothing.
   */
});

describe("what keeps the opponent model honest", () => {
  it("is DETERMINISTIC: same seed, same position, same answer", () => {
    expect(decide(polling("Bob"))).toBe(decide(polling("Bob")));
  });

  it("models opponents from a state ALREADY REDACTED FOR THE SEARCHER", () => {
    // The safe direction: a modelled opponent is given no more than the
    // searcher can see, and usually less — their own hand is blanked to
    // them in this copy. The model can only ever be more ignorant than
    // the real player, never better informed.
    const masked = redactFor(polling("Bob"), ME);
    const bobHand = masked.seats.find((s) => s.id === "Bob")?.hand ?? [];
    expect(bobHand.length).toBeGreaterThan(0);
    expect(bobHand.every((c) => c.name === "")).toBe(true);
  });

  it("runs simulations, and none of them throws", () => {
    const a = agent();
    decide(polling("Bob"), a);
    expect(a.simulationsRun).toBeGreaterThan(0);
    expect(a.simulationFailures).toBe(0);
  });
});

describe("the horizon is what changed", () => {
  it("leaves a decision with no referendum alone", () => {
    // A referendum counting as "in flight" must not make an ordinary
    // decision behave oddly.
    const state = threeSeatGame();
    const engine = new VtesEngine(state, buildHandlerRegistry());
    const dp = engine.decision();
    expect(dp).not.toBeNull();
    const chosen = agent().decide(dp!, dp!.options, viewFor(state, dp!.seat), redactFor(state, dp!.seat));
    expect(dp!.options.map((o) => o.id)).toContain(chosen);
  });
});
