/**
 * The oust window (docs/victory-points-design.md §7): a bot holding Life
 * Boon must never keep its OWN prey in the game — that throws away its own
 * victory point and 6 pool — while saving someone else's prey is a play.
 */

import { describe, expect, it } from "vitest";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import { viewFor } from "../../src/engine/agent.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import type { GameState } from "../../src/engine/state.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Carol holds a Life Boon; `victim` has no pool on `turnSeat`'s turn. */
function scores(victim: string, turnSeat: string, carolPool = 10): { play: number; pass: number } {
  const state: GameState = threeSeatGame();
  state.seats.find((s) => s.id === victim)!.pool = 0;
  const carol = state.seats.find((s) => s.id === "Carol")!;
  carol.pool = carolPool;
  carol.hand.push({ id: "lb", name: "Life Boon" });
  const tf = state.frames[0]!;
  if (tf.kind === "turn") tf.seat = turnSeat;
  const engine = new VtesEngine(state, testRegistry);
  const dp = engine.decision()!;
  expect(dp.window).toBe("oust");
  const agent = new HeuristicAgent({ seed: 3 });
  const view = viewFor(state, "Carol");
  const play = dp.options.find((o) => o.id.startsWith("play:Life Boon"))!;
  const pass = dp.options.find((o) => o.id === "pass")!;
  return { play: agent.score(play, dp, view), pass: agent.score(pass, dp, view) };
}

describe("the oust window and the bot", () => {
  it("keeps somebody else's prey in the game", () => {
    // Bob is Alice's prey, not Carol's (Carol's prey is Alice).
    const s = scores("Bob", "Alice");
    expect(s.play).toBeGreaterThan(s.pass);
  });

  it("NEGATIVE SPACE: never its own prey", () => {
    // Alice is Carol's prey: saving her costs Carol a point and 6 pool.
    const s = scores("Alice", "Bob");
    expect(s.play).toBeLessThan(s.pass);
  });

  it("NEGATIVE SPACE: not from a pool near its own floor", () => {
    const s = scores("Bob", "Alice", 3);
    expect(s.play).toBeLessThan(s.pass);
  });
});
