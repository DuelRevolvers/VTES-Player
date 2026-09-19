# Seat relationships — one helper, four relations (2026-09-18)

**Status: designed, not built. Owner review before kernel code.**

Depends on nothing. `ai-vote-scoring-design.md`,
`ai-referendum-terms-design.md` and `ai-block-action-value-design.md` all
consume it.

## 1. What exists, and where it disagrees with itself

`src/ai/heuristic.ts` has `preyOf(view, seat)`, walking the live seats.
`src/ai/search.ts` has `neighbour(state, me, step)` and calls it with
`-1` to get a predator. **Two files, two spellings, one question** — the
project's own "one question asked in two places will drift" lesson, with
the drift not yet arrived.

There is **no `predatorOf` in the policy at all**. The policy's entire
model of the table is "the seat on my left". That is half of VTES.

## 2. The four relations, and what each is worth

Table order is a cycle and your prey sits on your left (p. 15). From any
live seat there are four relations, and they have genuinely different
values — this is not a gradient, it is a **sign table**.

| relation | why it matters | pool OFF them | pool ONTO them |
| --- | --- | --- | --- |
| **me** | my life (p. 4) | disaster | good |
| **prey** | the seat I score by ousting | **very good** | bad |
| **predator** | the seat bleeding me | good | **bad** |
| **cross-table** | neither | mildly good | mildly bad |

Two asymmetries are worth stating rather than leaving to weights:

**Ousting my prey pays me twice.** `processOusts` in
`src/engine/engine.ts` reads the predator *before* the oust rewrites
adjacency and then emits `VictoryPointGained` **and** `PoolGained` of 6 to
them — "You receive 1 victory point when your prey is ousted" (p. 44) and
the surviving predator also gains 6 pool (p. 36). **Whatever caused the
oust.** So pool coming off my prey is not merely progress toward a VP; at
the threshold it IS the VP, plus six pool, plus a new prey.

**My predator's pool is worth less to me than my prey's.** Taking it
lowers the pressure on me but scores me nothing — which is why
`search.ts` already prices `predatorPool` at −0.3 against `preyPool` at
−2. That ratio was chosen rather than measured, and this doc does not
change it; it only makes the policy able to express it at all.

## 3. The shape

One module — `src/ai/seats.ts` — so there is exactly one answer:

```ts
export type Relation = "me" | "prey" | "predator" | "cross";

/** Live seats only, in table order; p. 15. */
export function relationTo(view: PlayerView, me: SeatId, them: SeatId): Relation;

/** The whole ring at once, for a scorer that walks a terms allocation. */
export function relations(view: PlayerView, me: SeatId): Record<SeatId, Relation>;
```

Notes that are rules and not preferences:

- **Ousted seats are excluded before the ring is walked**, exactly as
  `preyOf` does today. A dead seat between me and my prey does not make
  the live one cross-table.
- **A two-seat table makes the same seat prey AND predator.** `prey` wins
  the tie, because that is the relation that scores. This must be a
  written-down decision rather than an accident of `if` order.
- **`relationTo(me, me)` is `"me"`**, never `"cross"`, and the ring walk
  never gets the chance to say otherwise.
- `preyOf` in `heuristic.ts` and `neighbour` in `search.ts` are both
  **deleted and re-pointed** at this module. Leaving either in place is
  the drift this doc exists to prevent.

## 4. Why this is not the thing §8 ruled out

`richer-options-design.md` §8 killed `blockPressure` and `bleedPressure`
because the quantity was **identical across every option in the
decision** — the prey's pool is the same whichever of my vampires bleeds.

A relation is different in kind: it is a property of **the seat an option
NAMES**, and options in one list name different seats. A vote has a
direction; a terms allocation has a victim; a block has an action aimed
somewhere. For those lists the relation varies by construction, which is
precisely §8's test for a term that can change an argmax.

**Where it does not vary, it will do nothing, and that is expected.** A
minion-phase list of my own plays names only me. This helper is for the
decisions that name somebody else.

## 5. Tests

- A ring test at 2, 3, 4 and 5 seats: every seat's view of every other
  seat, asserted against a hand-written table. Not a loop that recomputes
  the thing it is checking.
- **Ousted seats:** a 5-seat ring with seats 2 and 3 ousted; seat 1's prey
  is seat 4, not seat 2.
- The 2-seat tie, asserted explicitly as `"prey"`.
- A test that `heuristic.ts` and `search.ts` agree — same view, same
  answer — since removing that disagreement is the point.

## 5.1 BUILT, 2026-09-18 (platform 0.10.68)

`src/ai/seats.ts`: `Relation`, `SeatRing`, `preyOf`, `predatorOf`,
`relationTo`, `relations`. `preyOf` is gone from `heuristic.ts` and
`neighbour` is gone from `search.ts`; both now import the one helper, so
**the policy has a `predatorOf` for the first time.**

Two details settled in the building that the design did not say:

- **The helper is structural over `{ seats: Array<{id, ousted}> }`**
  rather than over `PlayerView`. The policy holds a view and the search
  holds a `GameState`, and both already satisfy that shape — so one
  implementation serves both, which is what makes the drift impossible
  rather than merely unlikely. A `PlayerView`-only helper would have left
  `search.ts` with its own copy, which is the situation this doc exists
  to end.
- **`relations` includes OUSTED seats, mapped to `cross`.** A set of
  terms can name a seat that has since left, and a lookup with no entry
  for them reads as `undefined` at the call site — which is how a missing
  relation becomes a silent zero. Every seat in the ring gets an answer;
  only the ring WALK excludes the dead.

`tests/ai/seat-relations.test.ts`, 12 assertions: hand-written rings at
1–5 seats (not a loop that recomputes what it checks), ousted seats not
making a live neighbour cross-table, the two-seat tie resolving to prey,
a seat id that is not in the ring returning null, and the policy and the
search agreeing on the same fixture.

**No behaviour changed**, as predicted: both simulate tables run 0 errors
and the whole suite is green. This is an enabler, and it is measured
through its consumers (items 3, 4 and 7).

## 6. Open question for the owner

**The cross-table weight.** At 4 and 5 seats there is more than one
cross-table seat, and standard VTES play distinguishes them (your
grand-prey is nearly your prey's problem; your grand-predator is nearly
your predator's). This design flattens all of them to `"cross"`.

The flat version is proposed because it is the one that can be measured
at three seats, which is the table this project actually simulates. If
you want the finer ring, it is a `Relation` union of six rather than four
and nothing else changes — but it cannot be validated until the bench
runs five-seat tables (`ai-politics-bench-design.md` §5).
