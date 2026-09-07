/**
 * THE AI PLAYS WITH WHAT A PLAYER CAN SEE — owner ruling, 2026-09-06:
 * "The AI should work like a player and only work off of the information
 * a normal player would possibly know or can see/read from the table."
 *
 * That ruling settles the AI v2 route question (docs/ai-v1-design.md §8):
 * handing a search agent the real `GameState` through a privileged path
 * is out, whatever it would cost to build. This file is the standing
 * guard that keeps the line where the ruling puts it.
 *
 * Two existing tests cover the halves either side of this one:
 *  - `heuristic.test.ts` reads the POLICY's import lines and fails if it
 *    imports `GameState` or `redactFor` — the agent cannot reach past its
 *    view;
 *  - `player-view.test.ts` checks each zone of `viewFor` against its
 *    rulebook citation on a hand-built fixture.
 *
 * What neither can catch is a NEW `PlayerView` field carrying something
 * hidden — which is exactly the pressure widening the view for a search
 * agent would put on it. So this walks REAL DEALT GAMES and checks the
 * view the way the boundary actually works: structurally, per card
 * INSTANCE, over the whole document. A field added anywhere in
 * `PlayerView` that carries a face-down card fails here, because the walk
 * does not know or care which field it came from.
 *
 * A name check would not do: a card can sit in one seat's hidden hand and
 * face up on the table at the same time, so the same string is legitimate
 * in one place and a leak in another. Only the instance says which.
 */

import { describe, expect, it } from "vitest";
import { FACE_DOWN, viewFor } from "../../src/engine/agent.ts";
import { openHandsFor } from "../../src/engine/derived.ts";
import { VtesEngine } from "../../src/engine/engine.ts";
import type { GameState, SeatId } from "../../src/engine/state.ts";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { preconDeck, supportedPrecons } from "../../src/ui/deckimport.ts";
import { buildGame } from "../../src/ui/decks.ts";

const registry = buildHandlerRegistry();
const SEATS: SeatId[] = ["A", "B", "C", "D"];
const precon = supportedPrecons().filter((p) => p.playable)[0]!;
const decks = SEATS.map((s) => preconDeck(precon.set, precon.name, s)!);

/**
 * Every `{id, name}` pair anywhere in a value, however deeply nested.
 *
 * Deliberately structural and field-blind: it is looking for card objects
 * wherever they turn up, including in a field that does not exist yet.
 * One id can map to several names only if something is inconsistent, so
 * the set is kept rather than the last one seen.
 */
function namedCards(v: unknown, out: Map<string, Set<string>>): void {
  if (Array.isArray(v)) {
    for (const x of v) namedCards(x, out);
    return;
  }
  if (v === null || typeof v !== "object") return;
  const o = v as Record<string, unknown>;
  const id = o["id"];
  const name = o["name"];
  if (typeof id === "string" && typeof name === "string") {
    let seen = out.get(id);
    if (!seen) {
      seen = new Set<string>();
      out.set(id, seen);
    }
    seen.add(name);
  }
  for (const k of Object.keys(o)) namedCards(o[k], out);
}

/**
 * The card instances this seat may NOT read, taken from the real state.
 *
 * Each line is a rulebook rule, not a guess about the implementation:
 * another Methuselah's hand (p. 7), every draw pile INCLUDING YOUR OWN
 * (p. 14 — you may not read your own deck), another Methuselah's
 * uncontrolled region (p. 14, face down until it reaches the ready
 * region, p. 36), and a face-down store on somebody else's card in play.
 *
 * The two legitimate exceptions are asked of the engine rather than
 * assumed away: a hand that is OPEN (Owl Companion, Revelations superior)
 * and a card this seat has been SHOWN and therefore remembers.
 */
function hiddenFrom(state: GameState, seat: SeatId): Set<string> {
  const open = openHandsFor(state, seat);
  const known = new Set(state.knowledge?.[seat] ?? []);
  const out = new Set<string>();
  for (const s of state.seats) {
    const mine = s.id === seat;
    if (!mine && !open.includes(s.id)) {
      for (const c of s.hand) if (!known.has(c.id)) out.add(c.id);
    }
    for (const c of s.library) out.add(c.id);
    for (const m of s.crypt) out.add(m.id);
    if (mine) continue;
    for (const u of s.uncontrolled) out.add(u.card.id);
    const entries = [...s.permanents, ...s.minions.flatMap((m) => m.attached)];
    for (const p of entries) {
      if (!p.stored || p.storedFaceUp) continue;
      for (const c of p.stored) out.add(c.id);
    }
  }
  return out;
}

/** Anything hidden that shows up in the view must show up FACE DOWN. */
function leaks(view: unknown, hidden: Set<string>): string[] {
  const seen = new Map<string, Set<string>>();
  namedCards(view, seen);
  const bad: string[] = [];
  for (const id of hidden) {
    for (const name of seen.get(id) ?? []) {
      if (name !== FACE_DOWN) bad.push(`${id} = ${name}`);
    }
  }
  return bad;
}

interface Walk {
  decisions: number;
  /** Hidden instances checked, summed over every decision. */
  hiddenSeen: number;
}

/** Play a dealt game with AI seats, checking every view handed out. */
function walk(seed: number, maxDecisions = 4000): Walk {
  const engine = new VtesEngine(buildGame({ decks, seed, maxTurns: 40 }), registry);
  const agents: Record<SeatId, HeuristicAgent> = {};
  for (const s of SEATS) agents[s] = new HeuristicAgent({ seed: seed + s.charCodeAt(0) });
  const w: Walk = { decisions: 0, hiddenSeen: 0 };
  for (;;) {
    const dp = engine.decision();
    if (!dp || w.decisions >= maxDecisions) break;
    const view = viewFor(engine.state, dp.seat);
    const hidden = hiddenFrom(engine.state, dp.seat);
    w.hiddenSeen += hidden.size;
    const bad = leaks(view, hidden);
    // Report the decision as well as the card: a leak that only appears
    // in one window is the interesting kind.
    expect(bad, `${dp.seat} @ ${dp.window}: ${bad.join(", ")}`).toEqual([]);
    w.decisions++;
    engine.choose(agents[dp.seat]!.decide(dp, dp.options, view));
  }
  return w;
}

describe("the AI sees only what a player at the table can see", () => {
  it("hands out no hidden card, at any decision, over whole games", () => {
    const a = walk(11);
    const b = walk(23);
    // Not vacuous: there really were games, and there really were cards
    // to leak. Without these the assertion above would pass just as
    // happily on a walk that never ran.
    //
    // MEASURED, and worth knowing: one walk checks ~306,000 hidden
    // instances and NONE of them reaches the view at all, not even face
    // down — `viewFor` collapses a hidden zone to a count rather than to
    // masked cards. So the walk cannot prove the detector works, and the
    // positive control below is the half that does.
    expect(a.decisions).toBeGreaterThan(200);
    expect(b.decisions).toBeGreaterThan(200);
    expect(a.hiddenSeen).toBeGreaterThan(1000);
  });

  it("catches a leak when there is one — the positive control", () => {
    // A measuring instrument has to be measured first. Without this, the
    // test above passes on a detector that can see nothing at all, which
    // is this project's oldest failure shape wearing a new hat.
    const engine = new VtesEngine(buildGame({ decks, seed: 11, maxTurns: 40 }), registry);
    const dp = engine.decision()!;
    const state = engine.state;
    const hidden = hiddenFrom(state, dp.seat);
    expect(leaks(viewFor(state, dp.seat), hidden)).toEqual([]);

    // The exact shape the ruling forbids: a field carrying real cards
    // from a zone this seat may not read. It does not matter that no such
    // field exists today — the point is that one added tomorrow fails.
    const prey = state.seats.find((s) => s.id !== dp.seat)!;
    const leaky = { ...viewFor(state, dp.seat), lookahead: { hand: prey.hand } };
    expect(leaks(leaky, hidden).length).toBeGreaterThan(0);

    // And your OWN library is hidden too (p. 14), which is the rule most
    // easily lost when widening the view for a search agent — a
    // determinizing agent may guess at a deck, never read it.
    const own = state.seats.find((s) => s.id === dp.seat)!;
    const ownLeak = { ...viewFor(state, dp.seat), deck: own.library };
    expect(leaks(ownLeak, hidden).length).toBeGreaterThan(0);
  });
});
