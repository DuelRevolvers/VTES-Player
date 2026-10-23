/**
 * Auctions and the bot (docs/auctions-design.md §6). A bid is a pool spend
 * the option does not carry as a cost, so the bot prices it from what the
 * option reports: what winning costs (`pays`) against half the vampire's
 * capacity. Calling an auction is guarded the same way.
 */

import { describe, expect, it } from "vitest";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import { viewFor } from "../../src/engine/agent.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import type { DecisionPoint, GameState, LegalOption } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const agent = new HeuristicAgent({ seed: 3 });
const seat = (state: GameState, id: string) => state.seats.find((s) => s.id === id)!;
const score = (state: GameState, dp: DecisionPoint, o: LegalOption): number =>
  agent.score(o, dp, viewFor(state, dp.seat));
const option = (dp: DecisionPoint, id: string): LegalOption => {
  const o = dp.options.find((x) => x.id === id);
  if (!o) throw new Error(`no ${id} in ${dp.options.map((x) => x.id).join(", ")}`);
  return o;
};
function masterPhase(state: GameState, seatId: string): VtesEngine {
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.seat = seatId;
    tf.phase = "master";
    tf.masterActionsLeft = 1;
  }
  return new VtesEngine(state, testRegistry);
}
function played(engine: VtesEngine, id: string): DecisionPoint {
  runTrace(engine, [["Alice", id]]);
  while (engine.decision()?.window === "card.asPlayed") {
    runTrace(engine, [[engine.decision()!.seat, "pass"]]);
  }
  return engine.decision()!;
}

describe("auctions and the bot", () => {
  it("calls a takeover on a rival's vampire, never on its own, and never sells a card", () => {
    const state = threeSeatGame();
    seat(state, "Alice").hand.push({ id: "ht", name: "Hostile Takeover" });
    seat(state, "Alice").hand.push({ id: "mta", name: "Malkavian Time Auction" });
    const dp = masterPhase(state, "Alice").decision()!;
    const pass = score(state, dp, option(dp, "pass"));
    expect(score(state, dp, option(dp, "play:Hostile Takeover:-:W:ht"))).toBeGreaterThan(pass);
    expect(score(state, dp, option(dp, "play:Hostile Takeover:-:V1:ht"))).toBeLessThan(pass);
    expect(score(state, dp, option(dp, "play:Malkavian Time Auction:-:V1:mta"))).toBeLessThan(pass);
  });

  it("opens with the least bid, and stops where winning costs more than half the capacity", () => {
    const state = threeSeatGame();
    seat(state, "Alice").hand.push({ id: "ht", name: "Hostile Takeover" });
    const engine = masterPhase(state, "Alice");
    const dp = played(engine, "play:Hostile Takeover:-:W:ht");
    const pass = score(state, dp, option(dp, "choice:Hostile Takeover:ht:bid:pass"));
    // W has capacity 5: worth 3 pool to win.
    expect(score(state, dp, option(dp, "choice:Hostile Takeover:ht:bid:1"))).toBeGreaterThan(pass);
    expect(score(state, dp, option(dp, "choice:Hostile Takeover:ht:bid:2"))).toBeLessThan(pass);
    // Alice opens at 3, the most W is worth to anybody but its controller.
    runTrace(engine, [["Alice", "choice:Hostile Takeover:ht:bid:3"]]);
    const bob = engine.decision()!;
    expect(bob.seat).toBe("Bob");
    // Bob controls W and pays half: 4 costs him 2, so he defends.
    expect(score(state, bob, option(bob, "choice:Hostile Takeover:ht:bid:4"))).toBeGreaterThan(
      score(state, bob, option(bob, "choice:Hostile Takeover:ht:bid:pass")),
    );
  });

  it("never bids where the runner-up pays too", () => {
    const state = threeSeatGame();
    seat(state, "Alice").hand.push({ id: "mta", name: "Malkavian Time Auction" });
    const dp = played(masterPhase(state, "Alice"), "play:Malkavian Time Auction:-:V1:mta");
    expect(dp.seat).toBe("Bob");
    expect(score(state, dp, option(dp, "choice:Malkavian Time Auction:mta:bid:1"))).toBeLessThan(
      score(state, dp, option(dp, "choice:Malkavian Time Auction:mta:bid:pass")),
    );
  });

  it("owes the most it may: the total is the same, and pool kept now can be spent", () => {
    const state = threeSeatGame();
    seat(state, "Alice").pool = 20;
    state.seats[0]!.minions[0]!.title = "justicar";
    seat(state, "Alice").hand.push({ id: "tgp", name: "Temptation of Greater Power" });
    const engine = masterPhase(state, "Alice");
    played(engine, "play:Temptation of Greater Power:-:W:tgp");
    runTrace(engine, [
      ["Alice", "choice:Temptation of Greater Power:tgp:bid:3"],
      ["Bob", "choice:Temptation of Greater Power:tgp:bid:pass"],
      ["Carol", "choice:Temptation of Greater Power:tgp:bid:pass"],
    ]);
    const dp = engine.decision()!;
    const scores = dp.options.map((o) => score(state, dp, o));
    expect(dp.options[scores.indexOf(Math.max(...scores))]!.id).toBe(
      "choice:Temptation of Greater Power:tgp:credit:3",
    );
  });
});
