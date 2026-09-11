/**
 * The Agent interface (architecture principle 5): humans and AI implement
 * the same contract. `view` is a masked projection of the state — the
 * hidden-information boundary. Other players' hands and everyone's
 * libraries (including your own — the deck is face down) are counts only.
 */

import type { DecisionPoint, LegalOption } from "./options.ts";
import type { ActionKind, CardInstance, CombatStep, GameState, MinionId, MinionState, PermanentInPlay, Range, SeatId } from "./state.ts";
import { currentBleed, currentIntercept, currentStealth, openHandsFor } from "./derived.ts";

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
    /**
     * The deck this Methuselah brought, one entry per copy — present ONLY
     * for the viewer's own seat, because deck lists are private in VTES.
     *
     * Owner ruling, 2026-09-06: the AI should know what is in its own
     * deck. That is what a player knows, having built it, and it is the
     * half of the information model that was missing — masking could say
     * what you may not SEE and had no way to say what you already KNOW.
     *
     * Composition, never order: the library is still face down to
     * everyone including its owner (p. 14). Subtract what you have drawn
     * and played, and what is left is what remains in the deck — which is
     * arithmetic a player at a table does all the time.
     */
    deckList?: { crypt: string[]; library: string[] };
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
    /**
     * A BLEED's live value, if this action is one — every static, aura,
     * conditional and modifier already played folded in.
     *
     * The same gap the option's own `bleed` closed one decision earlier
     * (docs/richer-options-design.md §4), and it survived there: a seat
     * deciding whether to BLOCK was reading the acting minion's PRINTED
     * `bleedAmount`, so a card in play or a modifier that made the bleed
     * worth three looked like a bleed worth one — and blocking is exactly
     * where that number decides whether pool is defended. Measured, 236 of
     * 269 block decisions in real games are against a bleed.
     *
     * Open information like the stealth beside it: the amount is a fold
     * over face-up cards, and it is what every seat at the table can see
     * they are about to lose.
     */
    bleed?: number;
    /** Intercept each of the VIEWER's own minions currently has against
     *  this action — what a block attempt would be worth right now. */
    intercept: Record<MinionId, number>;
    /** Set once a block has succeeded. */
    blockedBy: MinionId | null;
  };
  /**
   * The combat in progress, if there is one.
   *
   * THE SAME GAP THE BLOCKING NUMBERS FILLED, one frame along. `action`
   * exists because a seat asked to block was given no numbers to judge it
   * with; a seat asked to choose a strike, press, or spend a prevention
   * credit was given nothing at all — not who it was fighting, not their
   * blood, not the range, not the round. The policy compensated by
   * scoring strikes on kind alone and approximating "are we losing" from
   * its own weakest minion, which is a guess about the wrong minion.
   *
   * Every field is OPEN INFORMATION: both combatants are face up, the
   * range is known to the table (p. 29), and the round is something
   * everyone has been watching. Exposing it leaks nothing, and phase 6's
   * remote seat needs exactly the same to play its own combats.
   */
  combat?: {
    round: number;
    step: CombatStep;
    range: Range;
    /** The two combatants, and which side the VIEWER is on. `null` when
     *  the viewer controls neither — a bystander may still act (p. 28). */
    acting: MinionId;
    actingSeat: SeatId;
    opposing: MinionId;
    opposingSeat: SeatId;
    side: "acting" | "opposing" | null;
    /** The minion opposing the VIEWER, when they are in this combat —
     *  the one their strike would land on. */
    opponent: MinionId | null;
    /** True when this combat came from a successful block. */
    fromBlock: boolean;
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
    seats: state.seats.map((seatState) => {
      const mine = seatState.id === seat;
      // Taken OUT of the spread rather than overwritten with undefined:
      // `exactOptionalPropertyTypes` makes those different things, and
      // the field must be genuinely absent for another Methuselah — a
      // present-but-undefined key would still say "this seat has a deck
      // list" to anything walking the object.
      const { deckList, ...s } = seatState;
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
        // YOUR OWN deck list is yours to know — you built it (owner
        // ruling 2026-09-06). Another Methuselah's is not: deck lists are
        // private in VTES, which is the whole reason a search agent has
        // to GUESS at their hand rather than deduce it.
        //
        // Note this does not weaken the line above. The library stays
        // face down for everyone including its owner (p. 14), so what the
        // owner gains is the COMPOSITION and never the order.
        ...(mine && deckList ? { deckList } : {}),
        // …and what is STILL in them, sorted. Same ruling, one step on:
        // the composition of your own piles is yours to know, the order
        // is not, and sorting HERE is what makes that true on the wire
        // rather than only on the screen.
        ...(mine
          ? {
              ownPiles: {
                library: s.library.map((c) => c.name).sort((a, b) => a.localeCompare(b)),
                crypt: s.crypt.map((c) => c.name).sort((a, b) => a.localeCompare(b)),
              },
            }
          : {}),
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
          // Only for a bleed: every other action kind has no such number,
          // and reporting a 0 would read as "a bleed worth nothing".
          ...(af.actionKind === "bleed" ? { bleed: currentBleed(state, af) } : {}),
          intercept: Object.fromEntries(
            (state.seats.find((s) => s.id === seat)?.minions ?? []).map((m) => [
              m.id,
              currentIntercept(state, af.actionId, m.id),
            ]),
          ),
          blockedBy: af.blockedBy,
        }
      : null;
  // The combat in progress, same treatment and the same argument: every
  // field is face up at a real table, so none of it is a leak.
  const cf = [...state.frames].reverse().find((f) => f.kind === "combat");
  const combat =
    cf && cf.kind === "combat"
      ? {
          round: cf.round,
          step: cf.step,
          range: cf.range,
          acting: cf.acting,
          actingSeat: cf.actingSeat,
          opposing: cf.opposing,
          opposingSeat: cf.opposingSeat,
          // Which side the viewer is on, and null for a BYSTANDER — who
          // is not a mistake to handle: p. 28 lets a minion controlled by
          // any Methuselah play into a combat it is not in.
          side:
            cf.actingSeat === seat
              ? ("acting" as const)
              : cf.opposingSeat === seat
                ? ("opposing" as const)
                : null,
          opponent:
            cf.actingSeat === seat ? cf.opposing : cf.opposingSeat === seat ? cf.acting : null,
          fromBlock: cf.fromBlock,
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
      // `redacted` has already stripped this from every seat but the
      // viewer's, so this carries no rule of its own — the same reason
      // `viewFor` is defined in terms of `redactFor` at all.
      ...(s.deckList ? { deckList: s.deckList } : {}),
    })),
    ...(action ? { action } : {}),
    ...(combat ? { combat } : {}),
  };
}

export interface Agent {
  /**
   * `masked` is the SAME information as `view`, in the form the engine
   * itself uses — `redactFor(state, seat)`, which is a real `GameState`
   * with everything this seat may not see already blanked.
   *
   * It exists for a SEARCH agent, which needs to apply a candidate move
   * and look at the result, and cannot do that with a `PlayerView`
   * (a projection, not a game). It is not extra knowledge: it is exactly
   * the object multiplayer already sends to a remote player, so anything
   * readable in it is readable by a person playing that seat from another
   * machine (docs/ai-v2-design.md §2).
   *
   * Optional, so every existing agent, test and fixture is unchanged, and
   * so an agent that does not want it cannot accidentally depend on it.
   */
  decide(
    dp: DecisionPoint,
    options: LegalOption[],
    view: PlayerView,
    masked?: GameState,
  ): string;
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
