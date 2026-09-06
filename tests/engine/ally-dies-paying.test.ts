/**
 * An ally that spends its last LIFE to play a card.
 *
 * p. 11: an ally's life is held in the same field a vampire's blood is, so
 * "burn 1 blood to play this" spends a point of life — and an ally at 1
 * life pays with the last of itself. `burnDepleted` then removes it from
 * play, in the middle of the card play it just paid for.
 *
 * Reported from a playtest as "the action buttons disappear and I can't do
 * anything", which is the worst shape a bug can have: the game is not over
 * and there is nothing on screen to answer. The two halves are not the
 * same problem, which is why both are here:
 *
 *  - a REACTION is played by a bystander, so the frames outlive it;
 *  - a MODIFIER is played by the ACTING minion, so the action frame is
 *    left pointing at a minion that no longer exists.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, testRegistry, threeSeatGame } from "./fixtures.ts";

/** Every decision must be answerable. A decision with no options is the
 *  reported bug: nothing on screen, and the game not over. */
function walkOut(engine: VtesEngine, steps = 60): void {
  for (let i = 0; i < steps; i++) {
    const dp = engine.decision();
    if (!dp) return;
    expect(
      dp.options.length,
      `decision ${dp.seq} (${dp.seat}, ${dp.window}) had no options`,
    ).toBeGreaterThan(0);
    engine.choose((dp.options.find((o) => o.kind === "pass") ?? dp.options[0]!).id);
  }
}

describe("an ally that burns its last life to play a card", () => {
  it("survives being the REACTING minion — the bystander case", () => {
    // Alice bleeds Bob. Bob answers with an ally on its last point of
    // life, holding a reaction that costs exactly that point.
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    // "Plays cards as a vampire" (p. 11) — the ally holds the Discipline
    // the card requires, which is the whole reason it can play one.
    bob.minions.push(makeAlly("A1", "Bob", 1, { disciplines: { ani: "superior" } }));
    bob.hand.push({ id: "ss1", name: "Sentry Signal" });
    const engine = new VtesEngine(state, testRegistry);

    const first = engine.decision()!;
    engine.choose(first.options.find((o) => o.id.startsWith("bleed:V1"))!.id);

    let played = false;
    for (let i = 0; i < 40 && !played; i++) {
      const dp = engine.decision();
      if (!dp) break;
      expect(dp.options.length).toBeGreaterThan(0);
      const signal = dp.options.find((o) => o.id.startsWith("play:Sentry Signal"));
      if (signal && dp.seat === "Bob") {
        engine.choose(signal.id);
        played = true;
        break;
      }
      engine.choose((dp.options.find((o) => o.kind === "pass") ?? dp.options[0]!).id);
    }
    expect(played, "Sentry Signal was never offered — the fixture is wrong").toBe(true);

    expect(engine.state.seats.flatMap((s) => s.minions).some((m) => m.id === "A1")).toBe(false);
    walkOut(engine);
  });

  it("survives being the ACTING minion — the case that broke", () => {
    // The ally acts, then pays its last life for an action modifier. The
    // action frame is now pointing at a minion that has left play, and
    // everything that follows — the block window, resolution, the p. 25
    // consequences — has to cope with that.
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions.push(makeAlly("A1", "Alice", 1, { disciplines: { obf: "basic" } }));
    alice.hand.push({ id: "st1", name: "Seeds of Terror" });
    const engine = new VtesEngine(state, testRegistry);

    const first = engine.decision()!;
    engine.choose(first.options.find((o) => o.id.startsWith("bleed:A1"))!.id);

    let played = false;
    for (let i = 0; i < 40 && !played; i++) {
      const dp = engine.decision();
      if (!dp) break;
      expect(dp.options.length).toBeGreaterThan(0);
      const seeds = dp.options.find((o) => o.id.startsWith("play:Seeds of Terror"));
      if (seeds && dp.seat === "Alice") {
        engine.choose(seeds.id);
        played = true;
        break;
      }
      engine.choose((dp.options.find((o) => o.kind === "pass") ?? dp.options[0]!).id);
    }
    expect(played, "Seeds of Terror was never offered — the fixture is wrong").toBe(true);

    expect(engine.state.seats.flatMap((s) => s.minions).some((m) => m.id === "A1")).toBe(false);
    walkOut(engine);
  });
});
