/**
 * WHICH answer to a choice frame (docs/ai-answer-choice-design.md).
 *
 * The two families that actually occur, measured over 40 games: 53 of
 * 106 answerable choice decisions are a COST with a currency (Smiling
 * Jack's unlock toll), 45 are a discard-down (p. 7). Both were answered
 * in offered order, which is a coin flip on the seeded stream.
 *
 * THE REGRESSION GUARD MATTERS MOST HERE. Declining an optional choice
 * frame is a plain `pass`, and when this scored 0 against `pass` at 0.5
 * the AI turned down every optional payoff in the game. The new deltas
 * are added to `answerChoice` rather than replacing it, and there is a
 * test below that says so.
 */

import { describe, expect, it } from "vitest";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import { viewFor } from "../../src/engine/agent.ts";
import type { DecisionPoint, LegalOption } from "../../src/engine/options.ts";
import type { GameState } from "../../src/engine/state.ts";
import { threeSeatGame } from "../engine/fixtures.ts";

const ME = "Alice";

function decide(state: GameState, options: LegalOption[]): string {
  const dp: DecisionPoint = { seq: 1, seat: ME, window: "choice", options };
  return new HeuristicAgent({ seed: 4 }).decide(dp, options, viewFor(state, ME));
}

/** Smiling Jack's toll: burn a pool, or a blood from a named vampire. */
function toll(minion: string): LegalOption[] {
  return [
    {
      id: "choice:Smiling Jack:c1:unlockToll:pool",
      kind: "answerChoice",
      label: "Burn 1 pool",
      params: { pay: "pool", left: "1" },
    },
    {
      id: `choice:Smiling Jack:c1:unlockToll:blood:${minion}`,
      kind: "answerChoice",
      label: "Burn 1 blood",
      params: { pay: "blood", pick: minion, left: "1" },
    },
  ];
}

describe("paying a cost in the cheaper currency", () => {
  it("burns BLOOD rather than pool when the vampire can spare it", () => {
    // Pool is your life (p. 4); blood is fuel. V1 has blood to spare.
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.blood = 4;
    expect(decide(state, toll("V1"))).toContain(":blood:");
  });

  it("burns POOL when the vampire is down to its last blood", () => {
    // "A vampire with no blood left to mend goes to torpor" (p. 31), and
    // one at 0 MUST hunt (p. 21). Taking the last blood is not a saving.
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.blood = 1;
    expect(decide(state, toll("V1"))).toContain(":pool");
  });

  it("burns POOL when the named vampire has left play", () => {
    // A derived read must be TOTAL: the frame can outlive the minion.
    const state = threeSeatGame();
    expect(decide(state, toll("ghost"))).toContain(":pool");
  });
});

describe("discarding the most redundant card", () => {
  const discard = (names: string[]): LegalOption[] =>
    names.map((name, i) => ({
      id: `choice:Discard:c1:${i}`,
      kind: "answerChoice" as const,
      label: `Discard down to hand size: ${name}`,
      params: { card: `h${i}` },
      card: name,
    }));

  function withDeck(library: string[], hand: string[]): GameState {
    const state = threeSeatGame();
    state.seats[0]!.deckList = { crypt: [], library };
    state.seats[0]!.hand = hand.map((name, i) => ({ id: `h${i}`, name }));
    return state;
  }

  it("sheds the card it built four of, not the singleton", () => {
    const state = withDeck(
      ["Govern the Unaligned", "Govern the Unaligned", "Govern the Unaligned", "Govern the Unaligned", "Villein"],
      ["Govern the Unaligned", "Villein"],
    );
    expect(decide(state, discard(["Govern the Unaligned", "Villein"]))).toBe("choice:Discard:c1:0");
  });

  it("follows the deck rather than the option order", () => {
    // The rotation: same two cards, the counts swapped. Without this the
    // test would pass on a policy that simply preferred the first option.
    const state = withDeck(
      ["Villein", "Villein", "Villein", "Villein", "Govern the Unaligned"],
      ["Govern the Unaligned", "Villein"],
    );
    expect(decide(state, discard(["Govern the Unaligned", "Villein"]))).toBe("choice:Discard:c1:1");
  });

  it("counts copies in HAND as redundancy too", () => {
    // Nothing in the deck list to go on; two copies in hand still say
    // which one is cheap to lose.
    const state = withDeck([], ["Villein", "Villein", "Govern the Unaligned"]);
    expect(decide(state, discard(["Govern the Unaligned", "Villein"]))).toBe("choice:Discard:c1:1");
  });

  it("does not care when every candidate is a singleton", () => {
    // A singleton scores 0 rather than a bonus, so this falls to the
    // seeded tie-break — which is the previous behaviour, and correct.
    const state = withDeck(["A", "B"], ["A", "B"]);
    const options = discard(["A", "B"]);
    expect(options.map((o) => o.id)).toContain(decide(state, options));
  });
});

describe("the fallback is load-bearing", () => {
  it("still ANSWERS an optional choice rather than passing", () => {
    // The bug this file must never reintroduce: an optional frame is
    // declined by a plain `pass`, so an answer scoring 0 meant the AI
    // turned down every optional payoff in the game.
    const state = threeSeatGame();
    const options: LegalOption[] = [
      { id: "pass", kind: "pass", label: "decline" },
      {
        id: "choice:Cave of Apples:c1:take",
        kind: "answerChoice",
        label: "Take the blood",
        params: { answer: "yes" },
      },
    ];
    expect(decide(state, options)).toBe("choice:Cave of Apples:c1:take");
  });

  it("is TOTAL over params it does not recognise", () => {
    // A key means different things on different cards, so an unknown one
    // must fall through rather than be guessed at.
    const state = threeSeatGame();
    const options: LegalOption[] = [
      { id: "a", kind: "answerChoice", label: "a", params: { somethingNew: "x" } },
      { id: "b", kind: "answerChoice", label: "b", params: { somethingNew: "y" } },
    ];
    expect(["a", "b"]).toContain(decide(state, options));
  });
});
