/**
 * THE BOTS WANT TO SURVIVE (docs/ai-pool-preservation-design.md).
 *
 * Owner report, 2026-09-22: "as they are they will oust themselves
 * without thinking about it in order to play something."
 *
 * The policy had exactly one brake — a hard cliff in `scorePlay` that
 * refused to spend below 2 pool — and nothing at all between that and
 * "comfortable". Worse, the cliff only existed on the PLAY path, so the
 * influence phase, which a bot reaches every single turn, spent pool at a
 * flat `influenceTransfer` of 6 against a `pass` of 0.5 and walked a seat
 * on 4 pool down to 0 to part-fund a vampire it would never finish.
 *
 * What is pinned here is the SHAPE, not the numbers: a cliff that cannot
 * be crossed, a gradient above it that can be switched off, the
 * exemptions that stop thrift becoming paralysis, and the fact that the
 * styles disagree about where the line is.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, HeuristicAgent } from "../../src/ai/heuristic.ts";
import { PLAYSTYLES, type Playstyle } from "../../src/ai/playstyles.ts";
import { viewFor } from "../../src/engine/agent.ts";
import type { DecisionPoint, LegalOption, PlayEffect } from "../../src/engine/options.ts";
import type { GameState } from "../../src/engine/state.ts";
import { makeMinion, threeSeatGame } from "../engine/fixtures.ts";

/** Alice, on the pool given. Every other seat is left alone. */
function atPool(pool: number): GameState {
  const state = threeSeatGame();
  state.seats[0]!.pool = pool;
  return state;
}

const PASS: LegalOption = { id: "pass", kind: "pass", label: "Pass" };

/** A master costing `poolCost`, doing `effects`. */
function play(poolCost: number, effects: PlayEffect[] = [{ tag: "bleed", amount: 1 }]): LegalOption {
  return {
    id: `play:Master:-:-:c${poolCost}`,
    kind: "playCard",
    label: `Master (${poolCost} pool)`,
    card: `c${poolCost}`,
    name: "Master",
    minion: null,
    mode: null,
    params: {},
    cost: { blood: 0, pool: poolCost },
    effects,
  };
}

const TRANSFER: LegalOption = {
  id: "inf:add:u1",
  kind: "transferToVampire",
  label: "Transfer to U1",
  minion: "u1",
};
const TAKE_BACK: LegalOption = {
  id: "inf:take:u1",
  kind: "transferToPool",
  label: "Take a counter back from U1",
  minion: "u1",
};

/** Alice with a half-influenced vampire waiting, and a board unless
 *  `boardless` — a seat with nothing in play is exempt, so the fixture
 *  has to be able to say which case it is. */
function influencing(pool: number, opts: { boardless?: boolean } = {}): GameState {
  const state = atPool(pool);
  state.seats[0]!.uncontrolled.push({
    card: makeMinion("u1", "Alice", { capacity: 4 }),
    counters: 2,
  });
  if (opts.boardless) state.seats[0]!.minions = [];
  return state;
}

function score(
  state: GameState,
  o: LegalOption,
  style?: Playstyle,
  window: DecisionPoint["window"] = "turn.master",
): number {
  const agent = new HeuristicAgent(
    style ? { seed: 3, weights: PLAYSTYLES[style] } : { seed: 3 },
  );
  const dp: DecisionPoint = { seq: 1, seat: "Alice", window, options: [o, PASS] };
  return agent.score(o, dp, viewFor(state, "Alice"));
}

describe("the cliff: pool the bot will not spend below", () => {
  /** A 3-pool card worth playing: three bleed, which clears its own
   *  price at a comfortable pool. A card that nobody would play when
   *  rich makes a worthless control. */
  const WORTH_IT = play(3, [{ tag: "bleed", amount: 3 }]);

  it("refuses a play that would take it to the floor", () => {
    // 5 pool, a 3-pool master: 2 left, which is the floor. Refused,
    // however good the card is.
    expect(score(atPool(5), WORTH_IT)).toBe(DEFAULT_WEIGHTS.selfOustGuard);
  });

  it("takes the same play at a comfortable pool", () => {
    // THE POSITIVE CONTROL. Without it this file would pass on a policy
    // that simply never played a 3-pool card.
    expect(score(atPool(20), WORTH_IT)).toBeGreaterThan(DEFAULT_WEIGHTS.pass);
  });

  it("does NOT refuse a card that pays for itself", () => {
    // The cliff reads the NET spend. A seat on 5 pool refusing the
    // blood-to-pool master that would put it back on 7 is refusing the
    // cure because it has the disease.
    const villein = play(1, [{ tag: "poolGain", amount: 3 }]);
    expect(score(atPool(5), villein)).toBeGreaterThan(DEFAULT_WEIGHTS.pass);
    // And it is priced as an ordinary play while it is at it: the bite
    // brakes SPENDING, and this is not spending.
    expect(score(atPool(5), villein)).toBe(score(atPool(30), villein));
  });
});

describe("the gradient above the cliff", () => {
  it("makes a pool-costing play lose to passing when the pool is low", () => {
    // 6 pool: clear of the cliff (3 left), inside the threshold of 8. A
    // 2-pool card worth one bleed is no longer worth it.
    const low = score(atPool(6), play(2));
    expect(low).toBeLessThan(DEFAULT_WEIGHTS.pass);
    // THE NEGATIVE CONTROL: the same option, the same everything, one
    // number different.
    expect(score(atPool(30), play(2))).toBeGreaterThan(DEFAULT_WEIGHTS.pass);
  });

  it("is off at a comfortable pool — arithmetically the old line", () => {
    // Every measurement behind `poolCost` and `effectValue` was taken
    // above the threshold, so above it the policy has to be unchanged:
    // playCard 2 + 2 × −2 + bleed 3, and the +1 for our own action window.
    expect(score(atPool(30), play(2), undefined, "action.announce")).toBe(1 + 2 + -4 + 3);
  });

  it("can be switched OFF, which is what makes the claim falsifiable", () => {
    const off = new HeuristicAgent({ seed: 3, weights: { lowPoolCaution: 0 } });
    const dp: DecisionPoint = { seq: 1, seat: "Alice", window: "turn.master", options: [] };
    const o = play(2);
    expect(off.score(o, dp, viewFor(atPool(6), "Alice"))).toBe(
      off.score(o, dp, viewFor(atPool(30), "Alice")),
    );
    // The CLIFF is not part of the gradient and does not switch off with
    // it — a weight of 0 means "do not be thrifty", never "oust
    // yourself".
    expect(off.score(play(3), dp, viewFor(atPool(5), "Alice"))).toBe(
      DEFAULT_WEIGHTS.selfOustGuard,
    );
  });
});

describe("the influence phase, which had no brake at all", () => {
  it("refuses the transfer that would take it to the floor", () => {
    expect(score(influencing(3), TRANSFER, undefined, "turn.influence")).toBe(
      DEFAULT_WEIGHTS.selfOustGuard,
    );
  });

  it("still influences at a workable pool", () => {
    expect(score(influencing(10), TRANSFER, undefined, "turn.influence")).toBeGreaterThan(
      DEFAULT_WEIGHTS.pass,
    );
  });

  it("exempts a seat with NOTHING in play", () => {
    // Hoarding pool behind an empty table is a slower way of losing, not
    // a way of surviving: with no minion there is no bleed, no block and
    // no hunt, so the same 3 pool buys nothing by being kept.
    expect(
      score(influencing(3, { boardless: true }), TRANSFER, undefined, "turn.influence"),
    ).toBeGreaterThan(DEFAULT_WEIGHTS.pass);
  });

  it("pulls counters BACK when it is already at the floor", () => {
    // The mirror of the cliff, and the one case where undoing your own
    // influence is right: counters in the uncontrolled region buy nothing
    // until the vampire arrives, and a seat ousted first never gets
    // there.
    expect(score(influencing(2), TAKE_BACK, undefined, "turn.influence")).toBeGreaterThan(
      DEFAULT_WEIGHTS.pass,
    );
    // Self-limiting: it stops the moment the pool clears the floor, so
    // the region is never stripped.
    expect(score(influencing(6), TAKE_BACK, undefined, "turn.influence")).toBeLessThan(0);
  });
});

describe("paying a card's toll: which currency", () => {
  /** Smiling Jack's fork, with the named vampire on `blood`. */
  function fork(pool: number, blood: number): { state: GameState; opts: LegalOption[] } {
    const state = atPool(pool);
    state.seats[0]!.minions[0]!.blood = blood;
    const payPool: LegalOption = {
      id: "choice:Smiling Jack:c1:pay:pool",
      kind: "answerChoice",
      label: "Burn 1 pool",
      params: { pay: "pool" },
    };
    const payBlood: LegalOption = {
      id: "choice:Smiling Jack:c1:pay:blood",
      kind: "answerChoice",
      label: "Burn 1 blood",
      params: { pay: "blood", pick: state.seats[0]!.minions[0]!.id },
    };
    // NO `pass`. Smiling Jack's toll is what it costs to unlock, so the
    // real decision is which currency and not whether — and adding a
    // `pass` the engine does not offer would be a test about a fixture
    // rather than about the policy.
    return { state, opts: [payPool, payBlood] };
  }

  function decide(pool: number, blood: number): string {
    const { state, opts } = fork(pool, blood);
    const dp: DecisionPoint = { seq: 1, seat: "Alice", window: "turn.unlock", options: opts };
    return new HeuristicAgent({ seed: 3 }).decide(dp, opts, viewFor(state, "Alice"));
  }

  it("takes the last blood off a vampire rather than pay with its life", () => {
    // At the floor a point of pool is worth more than a vampire's last
    // point of blood: one is life (p. 4), the other is a hunt (p. 21).
    expect(decide(2, 1)).toContain(":blood");
  });

  it("pays the pool when the pool is there — the old behaviour", () => {
    // The negative control, and the ordering this file must not break:
    // rich, the bot protects the nearly-empty vampire instead.
    expect(decide(30, 1)).toContain(":pool");
  });
});

describe("the styles disagree about where the line is", () => {
  it("a Turtle stops where a Bruiser keeps spending", () => {
    // 7 pool, a 2-pool card. The Turtle's floor is 5, so this is refused
    // outright; the Bruiser is not even watching yet at 7.
    expect(score(atPool(7), play(2), "turtle")).toBe(DEFAULT_WEIGHTS.selfOustGuard);
    expect(score(atPool(7), play(2), "bruiser")).toBeGreaterThan(DEFAULT_WEIGHTS.pass);
  });

  it("a Turtle stops INFLUENCING to stay alive, and a Builder does not", () => {
    // The one behaviour no other style has. A Builder on 6 pool is inside
    // its threshold (11) and charges itself lightly (0.8), because bodies
    // are what it does.
    expect(score(influencing(6), TRANSFER, "turtle", "turn.influence")).toBe(
      DEFAULT_WEIGHTS.selfOustGuard,
    );
    expect(
      score(influencing(6), TRANSFER, "builder", "turn.influence"),
    ).toBeGreaterThan(DEFAULT_WEIGHTS.pass);
  });

  it("every style states all three, so none of them reads as not caring", () => {
    for (const style of Object.keys(PLAYSTYLES) as Playstyle[]) {
      if (style === "balanced") continue; // `{}` on purpose: the defaults.
      expect(PLAYSTYLES[style]).toHaveProperty("poolFloor");
      expect(PLAYSTYLES[style]).toHaveProperty("lowPoolThreshold");
      expect(PLAYSTYLES[style]).toHaveProperty("lowPoolCaution");
    }
  });

  it("and no style's floor lets it spend itself out", () => {
    // Whatever a bot's temperament, a seat at 0 pool is ousted (p. 4).
    for (const style of Object.keys(PLAYSTYLES) as Playstyle[]) {
      const floor = PLAYSTYLES[style].poolFloor ?? DEFAULT_WEIGHTS.poolFloor;
      expect(floor).toBeGreaterThanOrEqual(1);
      // …and the threshold has to be above the floor, or the gradient
      // runs backwards and the policy spends harder the closer it is to
      // death.
      const threshold = PLAYSTYLES[style].lowPoolThreshold ?? DEFAULT_WEIGHTS.lowPoolThreshold;
      expect(threshold).toBeGreaterThan(floor);
    }
  });
});
