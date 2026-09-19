/**
 * The AI reads the RANGE (docs/ai-combat-range-design.md).
 *
 * Found by a grep that returned nothing: neither agent had ever read
 * `view.combat.range`, `.round` or `.step`, though the projection has
 * carried all three since it was added — and the doc comment on it names
 * the range as one of the things a striker was being denied.
 *
 * The cost was that a hand strike at long range, which resolves to
 * NOTHING (p. 29 — the engine returns before any damage when
 * `range === "long" && !ranged`), scored `strikeDamage` plus the whole
 * `strikeLethal` bonus: the best option on the list, precisely when it
 * was the emptiest.
 */

import { describe, expect, it } from "vitest";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import { viewFor } from "../../src/engine/agent.ts";
import type { DecisionPoint, LegalOption } from "../../src/engine/options.ts";
import type { CombatFrame, GameState } from "../../src/engine/state.ts";
import { threeSeatGame } from "../engine/fixtures.ts";

/** Alice's V1 against Bob's W, at the range given. */
function inCombat(range: "close" | "long", foeBlood = 1): GameState {
  const state = threeSeatGame();
  const foe = state.seats[1]!.minions.find((m) => m.id === "W")!;
  foe.blood = foeBlood;
  state.frames.push({
    kind: "combat",
    round: 1,
    step: "chooseStrike",
    range,
    acting: "V1",
    actingSeat: "Alice",
    opposing: "W",
    opposingSeat: "Bob",
    fromBlock: false,
  } as unknown as CombatFrame);
  return state;
}

const HAND: LegalOption = {
  id: "strike:hand",
  kind: "chooseStrike",
  label: "Hand strike",
  strike: "hand",
};
const DODGE: LegalOption = {
  id: "strike:dodge",
  kind: "chooseStrike",
  label: "Dodge",
  strike: "dodge",
};
/** A gun's strike, which arrives as an ABILITY rather than a strike. */
const GUN: LegalOption = {
  id: "ability:.44 Magnum:c1:strike",
  kind: "useAbility",
  label: ".44 Magnum: strike (2R damage)",
  source: "c1",
  params: { action: "strike" },
};

function decide(state: GameState, options: LegalOption[]): string {
  const dp: DecisionPoint = { seq: 1, seat: "Alice", window: "combat.chooseStrike", options };
  return new HeuristicAgent({ seed: 11 }).decide(dp, options, viewFor(state, "Alice"));
}

describe("a hand strike at long range", () => {
  it("loses to a RANGED weapon that can actually reach", () => {
    // The headline. At long range the hand strike does nothing and the
    // gun does 2R — and before this the hand strike won, because the two
    // were priced at 2 apiece and the hand strike also collected the
    // lethal bonus.
    expect(decide(inCombat("long"), [HAND, GUN])).toBe(GUN.id);
  });

  it("does NOT collect the lethal bonus it cannot deliver", () => {
    // The foe is on 1 blood, so a landed hand strike would end it (p. 31).
    // At long range it lands on nothing, and a dodge is worth more.
    expect(decide(inCombat("long", 1), [HAND, DODGE])).toBe(DODGE.id);
  });

  it("is still the right answer at CLOSE range", () => {
    // The negative control. Same fixture, same options, one fact
    // different — without this the test would pass on a policy that
    // simply hated hand strikes.
    expect(decide(inCombat("close", 1), [HAND, GUN])).toBe(HAND.id);
    expect(decide(inCombat("close", 1), [HAND, DODGE])).toBe(HAND.id);
  });

  it("is taken when it is the ONLY option, unreachable or not", () => {
    // A strike must be chosen. The penalty has to lose to the other
    // strikes without making the option unpickable.
    expect(decide(inCombat("long"), [HAND])).toBe(HAND.id);
  });
});

describe("maneuvering", () => {
  const MANEUVER: LegalOption = {
    id: "maneuver:credit",
    kind: "useManeuver",
    label: "Maneuver",
  };
  const PASS: LegalOption = { id: "pass", kind: "pass", label: "pass" };

  it("closes the range when the striker cannot reach", () => {
    expect(decide(inCombat("long"), [PASS, MANEUVER])).toBe(MANEUVER.id);
  });

  it("does NOT open the range when it is already close", () => {
    // Maneuvering at close range moves to long, which is against the
    // interest of a minion whose strike is its hands. The policy cannot
    // see whether a gun is in hand, so it declines rather than guesses.
    expect(decide(inCombat("close"), [PASS, MANEUVER])).toBe(PASS.id);
  });
});

describe("a weapon that REACHES is chosen for a positive reason", () => {
  // Before, the bot preferred a gun at long range only because the hand
  // strike had been penalised — by elimination, not because the gun
  // works. The engine now says which strike abilities reach.
  const REACHING: LegalOption = { ...GUN, strikeReaches: true };

  it("outscores a generic ability at long range", () => {
    const agent = new HeuristicAgent({ seed: 11 });
    const dp: DecisionPoint = {
      seq: 1,
      seat: "Alice",
      window: "combat.chooseStrike",
      options: [HAND, REACHING, GUN],
    };
    const view = viewFor(inCombat("long"), "Alice");
    expect(agent.score(REACHING, dp, view)).toBeGreaterThan(agent.score(GUN, dp, view));
  });

  it("is picked over a hand strike and over an unmarked ability", () => {
    expect(decide(inCombat("long"), [HAND, GUN, REACHING])).toBe(REACHING.id);
  });

  it("claims no bonus at CLOSE range, where hands work too", () => {
    // The negative control: reaching is only worth paying for where the
    // alternative does not reach.
    const agent = new HeuristicAgent({ seed: 11 });
    const dp: DecisionPoint = {
      seq: 1,
      seat: "Alice",
      window: "combat.chooseStrike",
      options: [HAND, REACHING],
    };
    const view = viewFor(inCombat("close"), "Alice");
    expect(agent.score(REACHING, dp, view)).toBe(agent.score(GUN, dp, view));
  });
});

describe("maneuvering toward the range that suits you", () => {
  const PASS: LegalOption = { id: "pass", kind: "pass", label: "pass" };
  const maneuver = (armed: boolean): LegalOption => ({
    id: "maneuver:credit",
    kind: "useManeuver",
    label: "Maneuver",
    rangedStrikeAvailable: armed,
  });

  it("CLOSES when it is unarmed and stranded at long range", () => {
    expect(decide(inCombat("long"), [PASS, maneuver(false)])).toBe("maneuver:credit");
  });

  it("OPENS when it is holding a gun and standing at close range", () => {
    // The play this could not previously make: a ranged strike works at
    // any range and a hand strike does not, so a gun wants the distance.
    expect(decide(inCombat("close"), [PASS, maneuver(true)])).toBe("maneuver:credit");
  });

  it("stays put when the range already suits it", () => {
    // Armed at long, and unarmed at close: both already fine, and moving
    // is a cost rather than a free credit to burn.
    expect(decide(inCombat("long"), [PASS, maneuver(true)])).toBe("pass");
    expect(decide(inCombat("close"), [PASS, maneuver(false)])).toBe("pass");
  });
});

describe("negative space", () => {
  it("does not throw when there is no combat frame at all", () => {
    const state = threeSeatGame();
    expect(decide(state, [HAND, DODGE])).toBe(HAND.id);
  });
});
