/**
 * Boons and the bot (docs/boons-design.md §7). Each boon is a pool spend or
 * a gift the option does not carry as a cost, so each needs a guard keyed on
 * what the play DOES — and one guard from wave 103 refused the only boon
 * that costs its player nothing.
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
const option = (dp: DecisionPoint, prefix: string): LegalOption => {
  const o = dp.options.find((x) => x.id.startsWith(prefix));
  if (!o) throw new Error(`no ${prefix} in ${dp.options.map((x) => x.id).join(", ")}`);
  return o;
};
function onTurn(state: GameState, seatId: string): VtesEngine {
  const tf = state.frames[0]!;
  if (tf.kind === "turn") tf.seat = seatId;
  return new VtesEngine(state, testRegistry);
}

describe("Extremis Boon and the bot", () => {
  it("saves itself — the self-save costs nothing, so the pool floor does not apply", () => {
    const state = threeSeatGame();
    seat(state, "Carol").pool = 0;
    seat(state, "Carol").hand.push({ id: "xb", name: "Extremis Boon" });
    const dp = onTurn(state, "Alice").decision()!;
    expect(dp.window).toBe("oust");
    expect(score(state, dp, option(dp, "play:Extremis Boon"))).toBeGreaterThan(
      score(state, dp, option(dp, "pass")),
    );
  });

  it("opens the bidding for somebody else's prey, never for its own, and never bids it up", () => {
    // Carol out on Alice's turn; Alice bids first. Carol is Bob's prey.
    const state = threeSeatGame();
    seat(state, "Carol").pool = 0;
    seat(state, "Carol").hand.push({ id: "xb", name: "Extremis Boon" });
    const engine = onTurn(state, "Alice");
    runTrace(engine, [["Carol", "play:Extremis Boon"]]);
    while (engine.decision()?.window === "card.asPlayed") {
      runTrace(engine, [[engine.decision()!.seat, "pass"]]);
    }
    const alice = engine.decision()!;
    expect(alice.seat).toBe("Alice");
    const pass = score(state, alice, option(alice, "choice:Extremis Boon:xb:bid:pass"));
    expect(score(state, alice, option(alice, "choice:Extremis Boon:xb:bid:1"))).toBeGreaterThan(pass);
    expect(score(state, alice, option(alice, "choice:Extremis Boon:xb:bid:2"))).toBeLessThan(pass);
    runTrace(engine, [["Alice", "choice:Extremis Boon:xb:bid:1"]]);
    // NEGATIVE SPACE: Bob is Carol's predator — her oust is his point.
    const bob = engine.decision()!;
    expect(bob.seat).toBe("Bob");
    const bobPass = score(state, bob, option(bob, "choice:Extremis Boon:xb:bid:pass"));
    for (const o of bob.options.filter((x) => x.id !== "choice:Extremis Boon:xb:bid:pass")) {
      expect(score(state, bob, o)).toBeLessThan(bobPass);
    }
  });

  it("NEGATIVE SPACE: never buys the boon out", () => {
    const state = threeSeatGame();
    seat(state, "Carol").permanents.push({
      card: { id: "xb", name: "Extremis Boon" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Extremis Boon", "boon"],
      boonCreditor: "Bob",
    });
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Carol";
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    const dp = new VtesEngine(state, testRegistry).decision()!;
    expect(score(state, dp, option(dp, "ability:Extremis Boon:xb:payoff"))).toBeLessThan(
      score(state, dp, option(dp, "pass")),
    );
  });
});

describe("Lesser Boon and the bot", () => {
  it("NEGATIVE SPACE: never undoes its own block", () => {
    const state = threeSeatGame();
    seat(state, "Bob").hand = [{ id: "lb", name: "Lesser Boon" }];
    const engine = onTurn(state, "Alice");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    for (let i = 0; i < 20 && !engine.decision()!.options.some((o) => o.id === "block:W"); i++) {
      runTrace(engine, [[engine.decision()!.seat, "pass"]]);
    }
    runTrace(engine, [["Bob", "block:W"]]);
    for (let i = 0; i < 20; i++) {
      const dp = engine.decision()!;
      const play = dp.options.find((o) => o.id.startsWith("play:Lesser Boon"));
      if (play) {
        expect(score(state, dp, play)).toBeLessThan(score(state, dp, option(dp, "pass")));
        return;
      }
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    throw new Error("Lesser Boon was never offered");
  });
});

describe("Minor Boon and the bot", () => {
  /** `vampire` is going to torpor on Alice's turn; Carol holds the boon. */
  function torporWindow(vampire: string): { state: GameState; dp: DecisionPoint } {
    const state = threeSeatGame();
    seat(state, "Carol").hand.push({ id: "mnb", name: "Minor Boon" });
    state.seats.flatMap((s) => s.minions).find((m) => m.id === vampire)!.torporPending = {
      other: null,
    };
    const dp = onTurn(state, "Alice").decision()!;
    expect(dp.window).toBe("torpor");
    return { state, dp };
  }

  it("keeps its predator's vampire up: \"this vampire cannot bleed you\"", () => {
    // Carol's predator is Bob.
    const { state, dp } = torporWindow("W");
    expect(score(state, dp, option(dp, "play:Minor Boon"))).toBeGreaterThan(
      score(state, dp, option(dp, "pass")),
    );
  });

  it("NEGATIVE SPACE: not its prey's", () => {
    const { state, dp } = torporWindow("V1");
    expect(score(state, dp, option(dp, "play:Minor Boon"))).toBeLessThan(
      score(state, dp, option(dp, "pass")),
    );
  });
});

describe("Major Boon and the bot", () => {
  /** Alice's V1 bleeds Bob for `bleed` with Bob on `bobPool`; Carol holds it. */
  function boonScores(bleed: number, bobPool: number): { play: number; pass: number } {
    const state = threeSeatGame();
    seat(state, "Bob").pool = bobPool;
    state.seats[0]!.minions[0]!.bleedAmount = bleed;
    seat(state, "Carol").hand.push({ id: "mb", name: "Major Boon" });
    const engine = onTurn(state, "Alice");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    for (let i = 0; i < 30; i++) {
      const dp = engine.decision()!;
      const play = dp.options.find((o) => o.id.startsWith("play:Major Boon"));
      if (play) return { play: score(state, dp, play), pass: score(state, dp, option(dp, "pass")) };
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    throw new Error("Major Boon was never offered");
  }

  it("pays a bleed that would oust somebody else's prey", () => {
    const s = boonScores(2, 2);
    expect(s.play).toBeGreaterThan(s.pass);
  });

  it("NEGATIVE SPACE: not a bleed the target survives", () => {
    const s = boonScores(1, 10);
    expect(s.play).toBeLessThan(s.pass);
  });
});
