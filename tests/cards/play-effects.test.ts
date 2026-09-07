/**
 * WHAT A PLAY WOULD DO, reported on the option
 * (docs/richer-options-design.md §5).
 *
 * The engine is the only thing that knows what an option does; when it
 * does not say, every consumer re-derives it — the AI by scoring a card on
 * its price alone, which put a master that wins the game and a master that
 * does nothing at the same value.
 *
 * The guard that matters most here is the one on COVERAGE. A summary that
 * appears on some cards and not others is worse than none, because a
 * reader prices the unsummarised half as doing nothing — so this walks a
 * real game and requires every `playCard` option to carry the field, the
 * same shape as the existing cost check in `central-queries.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { viewFor } from "../../src/engine/agent.ts";
import { VtesEngine } from "../../src/engine/engine.ts";
import type { SeatId } from "../../src/engine/state.ts";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { cardSpecs } from "../../src/cards/effects/cards.ts";
import { EFFECT_TAGS, summariseEffects, summarisePermanent } from "../../src/cards/effects/summary.ts";
import { preconDeck, supportedPrecons } from "../../src/ui/deckimport.ts";
import { buildGame } from "../../src/ui/decks.ts";

const registry = buildHandlerRegistry();
const SEATS: SeatId[] = ["A", "B", "C", "D"];

function specNamed(name: string) {
  const s = cardSpecs.find((c) => c.name === name);
  expect(s, `no spec named ${name}`).toBeDefined();
  return s!;
}

describe("the effect summary", () => {
  it("sums a repeated family instead of listing it twice", () => {
    // A policy reading a list should not have to know to add them up.
    const fx = summariseEffects([
      { kind: "modifyBleed", amount: 1, limited: true },
      { kind: "modifyBleed", amount: 2, limited: true },
    ] as never);
    expect(fx).toEqual([{ tag: "bleed", amount: 3 }]);
  });

  it("keeps a reduction negative, because taking bleed away is the point", () => {
    const fx = summariseEffects([{ kind: "modifyBleed", amount: -2, limited: false }] as never);
    expect(fx).toEqual([{ tag: "bleed", amount: -2 }]);
  });

  it("reports no amount, rather than zero, for an effect with no size", () => {
    // An absent amount means "not counted in units". A reader that
    // defaults it to zero prices exactly the cards whose whole point is
    // not numeric — a cancel, a wake — as doing nothing.
    const fx = summariseEffects([{ kind: "wake" }] as never);
    expect(fx).toEqual([{ tag: "wake" }]);
    expect(fx[0]).not.toHaveProperty("amount");
  });

  it("says `board` for a card that stays on the table, and sharpens it", () => {
    // A hunting ground is a card in play AND a source of blood; a policy
    // weighing the pool cost wants both facts, so the refinement is added
    // to `board` rather than replacing it.
    const fx = summarisePermanent(specNamed("Asylum Hunting Ground"));
    expect(fx.map((e) => e.tag).sort()).toEqual(["bloodGain", "board"]);
  });

  it("classifies every primitive — the table is exhaustive by type", () => {
    // The compiler enforces this; the test states WHY it is enforced. A
    // `default:` case would let a new primitive be silently worth nothing,
    // which is indistinguishable from a card that correctly does nothing.
    const tags = Object.values(EFFECT_TAGS);
    expect(tags.length).toBeGreaterThan(120);
    // `null` is "carries nothing a policy can weigh", used deliberately
    // and sparingly — not a backlog of unclassified primitives.
    expect(tags.filter((t) => t === null).length).toBeLessThan(10);
  });
});

describe("every play option carries one", () => {
  it("over a real game, with no card left unsummarised", () => {
    const precon = supportedPrecons().filter((p) => p.playable)[0]!;
    const decks = SEATS.map((s) => preconDeck(precon.set, precon.name, s)!);
    const engine = new VtesEngine(buildGame({ decks, seed: 4, maxTurns: 40 }), registry);
    const agents: Record<SeatId, HeuristicAgent> = {};
    for (const s of SEATS) agents[s] = new HeuristicAgent({ seed: s.charCodeAt(0) });

    let seen = 0;
    for (let i = 0; i < 2500; i++) {
      const dp = engine.decision();
      if (!dp) break;
      for (const o of dp.options) {
        if (o.kind !== "playCard") continue;
        seen++;
        // Present on EVERY play, including a hand-rolled card's, which is
        // the gap that once left `costTypes` undefined on Blood Doll.
        expect(o.effects, `${o.name} reported no effect summary`).toBeDefined();
      }
      engine.choose(agents[dp.seat]!.decide(dp, dp.options, viewFor(engine.state, dp.seat)));
    }
    expect(seen).toBeGreaterThan(50);
  });
});
