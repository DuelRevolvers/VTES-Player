/**
 * Who is who at the table — one helper, four relations
 * (docs/ai-seat-relationships-design.md).
 *
 * THIS EXISTS BECAUSE THE QUESTION WAS ASKED IN TWO PLACES AND ANSWERED
 * TWICE. `heuristic.ts` had `preyOf(view, seat)`; `search.ts` had
 * `neighbour(state, me, step)` and called it with `-1` for a predator.
 * Two files, two spellings, one question — the drift had not arrived yet,
 * and this is what stops it arriving.
 *
 * It also closes a real gap rather than merely tidying one: the POLICY
 * had no `predatorOf` at all. Its entire model of the table was "the seat
 * on my left", which is half of VTES — you are bled by the seat on your
 * right and you can do something about it.
 *
 * Structural over both callers on purpose. The policy holds a
 * `PlayerView` and the search holds a `GameState`, and both carry
 * `seats: Array<{ id, ousted }>` — so one implementation serves both and
 * there is no second ring walk to get wrong.
 */

import type { SeatId } from "../engine/state.ts";

/**
 * A seat's relation to you.
 *
 * Flat `cross` rather than a finer ring (grand-prey, grand-predator) is a
 * deliberate choice, not an oversight: the finer distinction only exists
 * at four and five seats, and this project simulates three. Widening it
 * is a six-member union and nothing else — but it cannot be VALIDATED
 * until the bench runs five-seat tables
 * (docs/ai-seat-relationships-design.md §6).
 */
export type Relation = "me" | "prey" | "predator" | "cross";

/** The shape both a `PlayerView` and a `GameState` already satisfy. */
export interface SeatRing {
  seats: Array<{ id: SeatId; ousted: boolean }>;
}

/**
 * The live seats, in table order.
 *
 * OUSTED SEATS COME OUT BEFORE THE RING IS WALKED, which is the rule and
 * not an optimisation: a dead seat sitting between you and your prey does
 * not make the live one cross-table. The engine agrees — `processOusts`
 * reads the predator BEFORE the oust, precisely because the oust rewrites
 * adjacency.
 */
function live(ring: SeatRing): SeatId[] {
  return ring.seats.filter((s) => !s.ousted).map((s) => s.id);
}

/** Your prey sits on your left (p. 15). Null at a table of one. */
export function preyOf(ring: SeatRing, seat: SeatId): SeatId | null {
  const order = live(ring);
  const i = order.indexOf(seat);
  if (i < 0 || order.length < 2) return null;
  return order[(i + 1) % order.length] ?? null;
}

/** Your predator sits on your right — the seat that bleeds you. */
export function predatorOf(ring: SeatRing, seat: SeatId): SeatId | null {
  const order = live(ring);
  const i = order.indexOf(seat);
  if (i < 0 || order.length < 2) return null;
  return order[(i - 1 + order.length) % order.length] ?? null;
}

/**
 * How `them` stands to `me`.
 *
 * Two orderings here are decisions rather than accidents of `if`, and
 * both are pinned by tests:
 *
 *  - **`me` is checked first**, so a seat is never cross-table to itself
 *    however the ring walks;
 *  - **at a table of two the same seat is both prey and predator, and
 *    PREY WINS.** That is the relation that scores: you get the victory
 *    point for ousting them (p. 44), and a heads-up game is decided by
 *    who ousts whom rather than by who is threatening whom.
 */
export function relationTo(ring: SeatRing, me: SeatId, them: SeatId): Relation {
  if (them === me) return "me";
  if (preyOf(ring, me) === them) return "prey";
  if (predatorOf(ring, me) === them) return "predator";
  return "cross";
}

/**
 * The whole ring at once — for a scorer that walks a terms allocation and
 * needs every seat it names, rather than asking one at a time.
 *
 * Includes OUSTED seats, mapped to `cross`: a set of terms can still name
 * a seat that has since left, and a lookup that simply had no entry for
 * them would read as "not in this object" at the call site, which is how
 * an undefined becomes a silent zero.
 */
export function relations(ring: SeatRing, me: SeatId): Record<SeatId, Relation> {
  const out: Record<SeatId, Relation> = {};
  for (const s of ring.seats) out[s.id] = relationTo(ring, me, s.id);
  return out;
}
