/**
 * AI v2 — the search agent (docs/ai-v2-design.md).
 *
 * The measured verdict is that its LOOKAHEAD does not yet beat the tuned
 * policy, and these tests are about the parts that ARE established: that
 * it plays legally, that it searches only what a player may see, that it
 * cannot disturb the real game, and — the control that makes the rest
 * meaningful — that with the lookahead turned off it reproduces the
 * policy, so any difference measured is the lookahead and not the
 * plumbing.
 */

import { describe, expect, it } from "vitest";
import { redactFor, viewFor } from "../../src/engine/agent.ts";
import { VtesEngine } from "../../src/engine/engine.ts";
import type { SeatId } from "../../src/engine/state.ts";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import { SearchAgent } from "../../src/ai/search.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { preconDeck, supportedPrecons } from "../../src/ui/deckimport.ts";
import { buildGame } from "../../src/ui/decks.ts";

const registry = buildHandlerRegistry();
const SEATS: SeatId[] = ["A", "B", "C", "D"];
const precon = supportedPrecons().filter((p) => p.playable)[0]!;
const decks = SEATS.map((s) => preconDeck(precon.set, precon.name, s)!);
const game = (seed = 3) => new VtesEngine(buildGame({ decks, seed, maxTurns: 25 }), registry);

describe("the search agent", () => {
  it("plays a whole game, only ever answering with an offered option", () => {
    const engine = game();
    const agents: Record<SeatId, SearchAgent> = {};
    for (const s of SEATS) agents[s] = new SearchAgent({ registry, seed: s.charCodeAt(0) });
    let decisions = 0;
    for (let i = 0; i < 1200; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const id = agents[dp.seat]!.decide(
        dp,
        dp.options,
        viewFor(engine.state, dp.seat),
        redactFor(engine.state, dp.seat),
      );
      // The legal-move generator is the single source of legality
      // (principle 4); the agent never reasons about what is allowed.
      expect(dp.options.some((o) => o.id === id)).toBe(true);
      engine.choose(id);
      decisions++;
    }
    expect(decisions).toBeGreaterThan(150);
    // Every simulation it ran actually ran: a search that silently fails
    // and falls back everywhere would pass every other test in this file.
    const total = SEATS.reduce((n, s) => n + agents[s]!.simulationsRun, 0);
    const failed = SEATS.reduce((n, s) => n + agents[s]!.simulationFailures, 0);
    expect(total).toBeGreaterThan(100);
    expect(failed).toBe(0);
  });

  it("does not disturb the game it is searching", () => {
    // It clones. If it did not, searching would BE playing — every
    // candidate move would land on the real table.
    const engine = game(5);
    const agent = new SearchAgent({ registry, seed: 1 });
    const dp = engine.decision()!;
    const masked = redactFor(engine.state, dp.seat);
    const beforeReal = JSON.stringify(engine.state);
    const beforeMasked = JSON.stringify(masked);
    agent.decide(dp, dp.options, viewFor(engine.state, dp.seat), masked);
    expect(JSON.stringify(engine.state)).toBe(beforeReal);
    expect(JSON.stringify(masked)).toBe(beforeMasked);
  });

  it("falls back to the policy when it is given no state to search", () => {
    // A transport that does not supply the masked state must still get a
    // legal answer, not a crash.
    const engine = game(7);
    const dp = engine.decision()!;
    const view = viewFor(engine.state, dp.seat);
    const search = new SearchAgent({ registry, seed: 11 }).decide(dp, dp.options, view);
    const policy = new HeuristicAgent({ seed: 11 }).decide(dp, dp.options, view);
    expect(search).toBe(policy);
  });

  it("with the lookahead off, it IS the policy — the control", () => {
    // THE ASSERTION THAT MAKES THE MEASUREMENTS MEAN ANYTHING. If this
    // drifts, a bench result attributed to the lookahead is really about
    // candidate ordering or the option cap.
    const engine = game(9);
    const search = new SearchAgent({ registry, seed: 4, weights: { lookahead: 0 } });
    const policy = new HeuristicAgent({ seed: 4 });
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const view = viewFor(engine.state, dp.seat);
      const masked = redactFor(engine.state, dp.seat);
      const a = search.decide(dp, dp.options, view, masked);
      const b = policy.decide(dp, dp.options, view);
      expect(a).toBe(b);
      if (dp.options.length > 1) checked++;
      engine.choose(b);
    }
    // Not vacuous: there really were choices where the two could differ.
    expect(checked).toBeGreaterThan(40);
  });

  it("fills its OWN library from its deck list, and nobody else's", () => {
    // Owner ruling, 2026-09-06: the AI knows what is in its own deck. A
    // simulated draw should therefore produce a card it might really
    // draw, not the blank the masking leaves behind.
    const engine = game(13);
    const agent = new SearchAgent({ registry, seed: 2 });
    const me = SEATS[0]!;
    const masked = redactFor(engine.state, me);
    const world = agent.determinize(masked, me);

    const mine = world.seats.find((s) => s.id === me)!;
    expect(mine.library.length).toBeGreaterThan(30);
    // Every card in MY library now has a real name…
    for (const c of mine.library) expect(c.name).not.toBe("");
    // …and each is really in my deck, not invented.
    const deck = new Set(mine.deckList!.library);
    for (const c of mine.library) expect(deck.has(c.name)).toBe(true);

    // Nobody else's is touched: deck lists are private, so an opponent's
    // library is exactly what this agent may NOT guess at.
    for (const s of world.seats) {
      if (s.id === me) continue;
      for (const c of s.library) expect(c.name).toBe("");
    }
  });

  it("does not deal itself a card it has already played", () => {
    // The remainder is the deck minus what the owner can see has left it.
    // Without that subtraction the simulation would happily draw a copy
    // of a unique card sitting in front of them.
    const engine = game(17);
    const agent = new SearchAgent({ registry, seed: 5 });
    const me = SEATS[0]!;
    // Play the game on a little so there is a hand and an ash heap.
    const policy = new HeuristicAgent({ seed: 5 });
    for (let i = 0; i < 300; i++) {
      const dp = engine.decision();
      if (!dp) break;
      engine.choose(policy.decide(dp, dp.options, viewFor(engine.state, dp.seat)));
    }
    const masked = redactFor(engine.state, me);
    const mine0 = masked.seats.find((s) => s.id === me)!;
    const world = agent.determinize(masked, me);
    const mine = world.seats.find((s) => s.id === me)!;

    const count = (names: string[]): Map<string, number> => {
      const m = new Map<string, number>();
      for (const n of names) m.set(n, (m.get(n) ?? 0) + 1);
      return m;
    };
    const deck = count(mine.deckList!.library);
    const held = count([
      ...mine.library.map((c) => c.name),
      ...mine0.hand.map((c) => c.name),
      ...(mine0.ashHeap ?? []).map((c) => c.name),
    ]);
    for (const [name, n] of held) {
      expect(n, `more copies of ${name} than the deck holds`).toBeLessThanOrEqual(
        deck.get(name) ?? 0,
      );
    }
    // Not vacuous: cards really had left the library by this point.
    expect(mine0.hand.length + (mine0.ashHeap ?? []).length).toBeGreaterThan(5);
  });

  it("searches ONLY the masked state, so it cannot see a hidden card", () => {
    // The owner's ruling of 2026-09-06. `redactFor` is the boundary and
    // this agent is handed its output — the same object multiplayer sends
    // a remote player — so the check is that what it receives carries no
    // opponent's hand.
    const engine = game(11);
    const dp = engine.decision()!;
    const masked = redactFor(engine.state, dp.seat);
    const others = engine.state.seats.filter((s) => s.id !== dp.seat);
    const json = JSON.stringify(masked);
    let hidden = 0;
    for (const s of others) {
      for (const c of s.hand) {
        hidden++;
        expect(json).not.toContain(`"name":"${c.name}","id":"${c.id}"`);
        // The instance is present (a face-down card occupies a position)
        // but nameless — which is the whole design of FACE_DOWN.
        const masked1 = masked.seats.find((x) => x.id === s.id)!.hand.find((x) => x.id === c.id);
        expect(masked1?.name).toBe("");
      }
    }
    expect(hidden).toBeGreaterThan(10);
  });
});
