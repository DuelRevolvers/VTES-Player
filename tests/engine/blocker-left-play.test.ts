/**
 * A BLOCKER CAN LEAVE PLAY WHILE ITS BLOCK ATTEMPT IS STILL ON THE STACK.
 *
 * Found by the AI bench (docs/ai-bench-design.md §8): 5 games in 800 died
 * on `unknown minion: C-lib-62` — a LIBRARY card id being looked up as a
 * minion, which is what an ALLY is, because an ally's `MinionId` is the id
 * of the library card that became it. The ally was gone while the block
 * attempt it had declared was still on the stack, and four places read
 * `ba.blocker` with `getMinion`, which throws.
 *
 * This is the engine's own recorded rule broken in four places at once:
 * *a minion can leave play at any point, so read it with `findMinion`, not
 * `getMinion`*. Three of the four are OPTION ENUMERATORS, which must be
 * total — a throw there surfaces as a game with no answerable decision
 * rather than as an error anybody can act on (the 2026-09-05 playtest
 * finding, where the same shape froze the table).
 *
 * The timing is the part worth understanding. `resolveBlockAttempt`
 * already fails an attempt whose blocker has left play, so the DANGEROUS
 * window is before that: the attempt's own impulse cycle, where every seat
 * is asked and every card in hand is enumerated against a blocker that is
 * no longer there.
 *
 * Neither the fuzz nor `npm run simulate` could have found it — both play
 * the mid-game snapshot, which has no allies blocking.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/engine.ts";
import type { GameState } from "../../src/engine/state.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { makeAlly, makeMinion, threeSeatGame } from "./fixtures.ts";

const registry = buildHandlerRegistry();

/**
 * Alice bleeds; Bob answers with an ALLY and holds Organized Resistance,
 * whose enumerator is the one that actually crashed. Its own conditions
 * are the fixture: it is "usable by a LOCKED baron", so Bob needs a locked
 * baron on the table as well as the ally doing the blocking.
 */
function game(): GameState {
  const state = threeSeatGame();
  const bob = state.seats[1]!;
  bob.minions.push(
    makeMinion("B-baron", "Bob", {
      title: "baron",
      sect: "anarch",
      locked: true,
      blood: 3,
    }),
  );
  bob.minions.push(makeAlly("Bob-lib-1", "Bob", 2, { sect: "anarch" }));
  bob.hand.push({ id: "or1", name: "Organized Resistance" });
  return state;
}

function walkTo(engine: VtesEngine, prefix: string, limit = 400): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    // A walker that takes the first option plays the board.
    const pass = dp.options.find((o) => o.kind === "pass");
    const end = dp.options.find((o) => o.kind === "endMinionPhase");
    engine.choose((pass ?? end ?? dp.options[0]!).id);
  }
  return false;
}

function choose(engine: VtesEngine, prefix: string): void {
  const dp = engine.decision();
  const want = dp?.options.find((o) => o.id.startsWith(prefix));
  expect(want, `no option "${prefix}" at ${dp?.window}`).toBeDefined();
  engine.choose(want!.id);
}

describe("a blocker that leaves play mid-attempt", () => {
  it("does not throw while its attempt is still being answered", () => {
    const engine = new VtesEngine(game(), registry);
    expect(walkTo(engine, "bleed:V1")).toBe(true);
    choose(engine, "bleed:V1");
    expect(walkTo(engine, "block:Bob-lib-1")).toBe(true);
    choose(engine, "block:Bob-lib-1");
    expect(engine.state.frames.some((f) => f.kind === "blockAttempt")).toBe(true);

    // THE EVENT THIS IS ABOUT. In the game that found it the ally had paid
    // its last life (an ally's life IS its blood, p. 11); removing it
    // directly pins the totality rather than one route to it.
    const bob = engine.state.seats.find((s) => s.id === "Bob")!;
    bob.minions = bob.minions.filter((m) => m.id !== "Bob-lib-1");

    // Before the fix this threw `unknown minion: Bob-lib-1` out of
    // `decision()` — the worst shape a bug can have, since the game is not
    // over and there is nothing on screen to answer.
    for (let i = 0; i < 80; i++) {
      const dp = engine.decision();
      if (!dp) break;
      expect(dp.options.length).toBeGreaterThan(0);
      const pass = dp.options.find((o) => o.kind === "pass");
      engine.choose((pass ?? dp.options[0]!).id);
    }
    // The attempt resolved rather than wedging, and the bleed went
    // through: a blocker that is not there does not block.
    expect(engine.state.frames.some((f) => f.kind === "blockAttempt")).toBe(false);
  });
});
