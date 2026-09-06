/**
 * Regressions for two engine bugs the fuzz harness could not see until its
 * decks were widened (2026-08-29). Each seat's library was built as
 * `for (k = 0; k < 15; k++) deckNames[k % deckNames.length]`, so only the
 * *first 15* of the 174 listed card names ever entered a fuzz game and
 * every card added since the early sweeps was decorative. With the decks
 * built from the whole list, two invariants broke immediately.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "./fixtures.ts";

describe("ballot restrictions stay in the polling window", () => {
  /** Closed Session is an action modifier whose only effect belongs to a
   *  referendum ("non-Camarilla vampires cannot cast votes or ballots this
   *  referendum"). The polling-only guard in the modifier compiler covered
   *  `modifyVotes` but not `restrictVotes`, so it was also offered as a
   *  plain modifier during any action — and resolving it there threw
   *  "restrictReferendumVotes outside a referendum". */
  it("is not offered as a plain action modifier during a bleed", () => {
    const state: GameState = threeSeatGame();
    state.seats[0]!.minions[0]!.title = "prince"; // satisfies its requirement
    state.seats[0]!.hand.push({ id: "cs", name: "Closed Session" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ]);

    const dp = engine.decision()!;
    expect(dp.window).toBe("action.effects");
    expect(dp.seat).toBe("Alice");
    expect(dp.options.some((o) => o.id.includes("Closed Session"))).toBe(false);
  });
});

describe("a mandatory choice with no legal answer", () => {
  /** The Rack asks its controller to choose a ready vampire as it enters
   *  play. A Methuselah with none produced a ChoiceFrame whose option list
   *  was empty and which nothing popped — the engine then offered a
   *  decision with zero options, breaking the harness's first invariant.
   *  An optional choice always has its Decline, so only a mandatory one
   *  could strand the loop. */
  it("pops instead of offering an empty decision", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    // Alice's only vampire is in torpor, so no ready vampire can be chosen.
    state.seats[0]!.minions = [makeMinion("V1", "Alice", { inTorpor: true })];
    state.seats[0]!.hand.push({ id: "rack", name: "The Rack" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:The Rack"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);

    const dp = engine.decision()!;
    expect(dp.options.length).toBeGreaterThan(0);
    expect(dp.window).not.toBe("choice");
    // The card is in play with no chosen vampire; the question is gone.
    const rack = state.seats[0]!.permanents.find((p) => p.card.id === "rack")!;
    expect(rack.chosen).toBeUndefined();
    expect(state.frames.some((f) => f.kind === "choice")).toBe(false);
  });
});
