/**
 * The Agent interface (architecture principle 5): humans and AI implement
 * the same contract. `view` is a masked projection of the state — the
 * hidden-information boundary. Other players' hands and everyone's
 * libraries (including your own — the deck is face down) are counts only.
 */

import type { DecisionPoint, LegalOption } from "./options.ts";
import type { ActionKind, CardInstance, GameState, MinionId, MinionState, PermanentInPlay, SeatId } from "./state.ts";
import { currentIntercept, currentStealth, openHandsFor } from "./derived.ts";

export interface PlayerView {
  you: SeatId;
  edge: SeatId | null;
  seats: Array<{
    id: SeatId;
    pool: number;
    ousted: boolean;
    victoryPoints: number;
    /** Ready and torpor minions — face up, so public (p. 14, p. 36). */
    minions: MinionState[];
    /** Cards in play are face up and public: locations, equipment on other
     *  minions, and anything else a Methuselah controls. */
    permanents: PermanentInPlay[];
    /**
     * Your own hand is visible; another seat's is a count — plus any
     * cards you have been SHOWN and therefore still know.
     *
     * `known` is the memory half of the hidden-information boundary, and
     * it is normally empty: only a card that reveals a hand puts anything
     * in it (Revelations). It is a SUBSET of `count`, never the whole
     * hand — the owner may have drawn since you looked
     * (docs/knowledge-design.md).
     */
    hand: CardInstance[] | { count: number; known: CardInstance[] };
    /** The uncontrolled region is dealt FACE DOWN and only its owner may
     *  look at it (p. 14: "deal the top four crypt cards face down into
     *  your uncontrolled region … you can look at the cards in your hand
     *  and in your uncontrolled region"); a vampire turns face up only when
     *  it moves to the ready region (p. 36). So `card` is null for another
     *  Methuselah's entries — but the blood counters stacked on a face-down
     *  card are still visible on the table, so `counters` always shows. */
    uncontrolled: Array<{ card: MinionState | null; counters: number }>;
    libraryCount: number;
    /** The crypt draw pile is face down — a count only, for everyone. */
    cryptCount: number;
    /** The discard pile, IN FULL for every seat: p. 16 says the ash heap
     *  "can be examined by any Methuselah at any time", so it is the one
     *  zone this projection never masks.
     *  docs/ash-heap-design.md */
    ashHeap: CardInstance[];
  }>;
  /**
   * The action in progress, if any — its PUBLIC facts.
   *
   * Added in phase 5, and the reason is worth recording: an agent could
   * not make a blocking decision without it. The rulebook is explicit
   * that a failed block may be retried "as often as the blocking
   * Methuselah wishes" (p. 25), so nothing stops a seat attempting the
   * same hopeless block forever — the termination is a JUDGEMENT, and a
   * judgement needs the numbers. A human reads them off the table;
   * `PlayerView` did not carry them at all.
   *
   * All of it is open information: the acting minion is face up, and
   * stealth and intercept are sums of cards played face up, which is why
   * exposing them is not a leak. Phase 6's remote seat needs exactly the
   * same. docs/ai-v1-design.md §3
   */
  action?: {
    actionId: string;
    kind: ActionKind;
    acting: MinionId;
    actingSeat: SeatId;
    /** The seat the action is directed at, if any (p. 25). */
    target: SeatId | null;
    directed: boolean;
    /** The acting minion's stealth as it stands. */
    stealth: number;
    /** Intercept each of the VIEWER's own minions currently has against
     *  this action — what a block attempt would be worth right now. */
    intercept: Record<MinionId, number>;
    /** Set once a block has succeeded. */
    blockedBy: MinionId | null;
  };
}

/**
 * A card the viewer may not see: the name is blanked and every printed
 * trait stripped, so nothing about it can be read off the object. Its `id`
 * survives — an opaque handle the viewer can already see on the table
 * (a face-down card occupies a position), and one that resolves to nothing
 * without the name.
 */
export const FACE_DOWN = "";

/** Is this a card the viewer cannot see? */
export function isFaceDown(m: { name: string }): boolean {
  return m.name === FACE_DOWN;
}

function faceDownMinion(m: MinionState): MinionState {
  return {
    ...m,
    name: FACE_DOWN,
    capacity: 0,
    disciplines: {},
    clan: null,
    sect: null,
    title: null,
    attached: [],
  };
}

/**
 * THE hidden-information boundary (architecture principle 5): the state as
 * one seat may legitimately see it, as a `GameState` — so it can be
 * rendered by the same code as the real thing, and sent to a peer as-is in
 * phase 6.
 *
 * What is hidden, with citations:
 *  - other Methuselahs' HANDS (p. 7 — cards in hand are yours to see);
 *  - every CRYPT and LIBRARY pile including your own, which are face down
 *    (you may not read your own deck);
 *  - other Methuselahs' UNCONTROLLED regions — dealt face down, and "you
 *    can look at the cards in your hand and in your uncontrolled region"
 *    is written about your own (p. 14). A vampire turns face up only when
 *    it moves to the ready region (p. 36). The blood counters stacked on a
 *    face-down card ARE visible, so counts survive.
 *
 * What stays visible: minions in the ready and torpor regions, every
 * Methuselah's cards in play, pools, victory points, the Edge — all face
 * up on the table.
 *
 * Deliberately NOT modelled yet: "who has looked at this card". An effect
 * that reveals a hand or the top of a library means that player keeps
 * knowing those cards afterwards, which structural masking cannot express
 * (docs/cockatrice-lessons.md §3). No implemented card reveals hidden
 * information yet, so nothing is wrong today — but it must be built before
 * phase 6 ships, not after.
 */
export function redactFor(state: GameState, seat: SeatId): GameState {
  // "While the employer is in combat, the opposing minion's controller
  // plays with an OPEN HAND" (Owl Companion) — derived from the live
  // combat, so it lifts by itself (docs/retainer-wave-design.md §1).
  const openHands = openHandsFor(state, seat);
  const known = new Set(state.knowledge?.[seat] ?? []);
  return {
    ...state,
    seats: state.seats.map((s) => {
      const mine = s.id === seat;
      const handOpen = mine || openHands.includes(s.id);
      return {
        ...s,
        // The ash heap passes through the spread UNMASKED, and that is
        // deliberate: p. 16 says it "can be examined by any Methuselah at
        // any time", which makes it the one fully public zone in the
        // game. Do not add it to the masked list below.
        // docs/ash-heap-design.md §8.1
        // Face-down piles: length is public, contents are not — including
        // your own, since you may not read your own deck.
        library: s.library.map((c) => ({ ...c, name: FACE_DOWN })),
        crypt: s.crypt.map(faceDownMinion),
        // A card this viewer has been SHOWN stays readable even in
        // somebody else's hand — they saw it, and a rule that made them
        // forget would be modelling a worse memory than a person has
        // (docs/knowledge-design.md). Cheap: `known` is empty in every
        // game where no card has revealed anything.
        hand: handOpen
          ? s.hand.map((c) => ({ ...c }))
          : s.hand.map((c) => (known.has(c.id) ? { ...c } : { ...c, name: FACE_DOWN })),
        uncontrolled: s.uncontrolled.map((u) => ({
          card: mine ? { ...u.card } : faceDownMinion(u.card),
          counters: u.counters,
        })),
        // Attached cards are copied properly rather than shared, because
        // an EQUIPMENT can carry a face-down store (Shilmulo Tarot) and
        // redaction had never reached inside a minion before.
        minions: s.minions.map((m) => ({
          ...m,
          attached: m.attached.map((p) => maskStore(p, mine)),
        })),
        permanents: s.permanents.map((p) => maskStore(p, mine)),
      };
    }),
  };
}

/**
 * A card in play may hold cards OUT OF PLAY on it (§5 of
 * docs/library-search-design.md). Face up, they are public; face down,
 * only the owner may look — so the count survives and the names do not.
 */
function maskStore(p: PermanentInPlay, mine: boolean): PermanentInPlay {
  if (!p.stored || p.storedFaceUp || mine) return { ...p };
  return { ...p, stored: p.stored.map((c) => ({ ...c, name: FACE_DOWN })) };
}

/**
 * The Agent-facing projection. Defined in terms of `redactFor` so there is
 * exactly ONE set of masking rules to get right — a second implementation
 * would be a second chance to leak.
 */
export function viewFor(state: GameState, seat: SeatId): PlayerView {
  const redacted = redactFor(state, seat);
  // The innermost action, and the numbers that decide a block. Read off
  // the REAL state rather than the redacted copy: these are derived sums
  // over the event log, and every term in them was played face up.
  const af = [...state.frames].reverse().find((f) => f.kind === "action");
  const action =
    af && af.kind === "action"
      ? {
          actionId: af.actionId,
          kind: af.actionKind,
          acting: af.acting,
          actingSeat: af.actingSeat,
          target: af.target,
          directed: af.directed,
          stealth: currentStealth(state, af.actionId),
          intercept: Object.fromEntries(
            (state.seats.find((s) => s.id === seat)?.minions ?? []).map((m) => [
              m.id,
              currentIntercept(state, af.actionId, m.id),
            ]),
          ),
          blockedBy: af.blockedBy,
        }
      : null;
  // The count/array split has to agree with the masking above, so it asks
  // the same helper rather than deriving the answer a second time.
  const openHands = openHandsFor(state, seat);
  return {
    you: seat,
    edge: redacted.edge,
    seats: redacted.seats.map((s) => ({
      id: s.id,
      pool: s.pool,
      ousted: s.ousted,
      victoryPoints: s.victoryPoints,
      minions: s.minions,
      permanents: s.permanents,
      hand:
        s.id === seat || openHands.includes(s.id)
          ? s.hand
          : {
              count: s.hand.length,
              // `redacted` has already unmasked what this viewer knows, so
              // the readable ones ARE the remembered ones — no second set
              // of rules, which is why `viewFor` is defined in terms of
              // `redactFor` in the first place.
              known: s.hand.filter((c) => !isFaceDown(c)),
            },
      uncontrolled: s.uncontrolled.map((u) => ({
        card: isFaceDown(u.card) ? null : u.card,
        counters: u.counters,
      })),
      libraryCount: s.library.length,
      cryptCount: s.crypt.length,
      ashHeap: [...(s.ashHeap ?? [])],
    })),
    ...(action ? { action } : {}),
  };
}

export interface Agent {
  decide(dp: DecisionPoint, options: LegalOption[], view: PlayerView): string;
}

/** Always passes when possible; otherwise takes the first option. Useful
 *  as a filler seat and for termination checks. */
export class PassAgent implements Agent {
  decide(_dp: DecisionPoint, options: LegalOption[], _view: PlayerView): string {
    const pass = options.find((o) => o.kind === "pass");
    const first = options[0];
    if (pass) return pass.id;
    if (!first) throw new Error("no options offered");
    return first.id;
  }
}
