# Transfers as a currency

Wave 63 (2026-09-17). Ennoia's Theater (100646), King's Rising (101059),
Whispers of the Nictuku (102176), Inconnu Tutelage (100970).

A transfer is the influence phase's unit of work: 1/2/3 on the game's
first three turns and 4 thereafter (p. 35–36), spent 1 to move a pool onto
an uncontrolled vampire, 2 to take one back, 4 (plus a pool) to move a
crypt card out. Until this wave the count only ever went **down**, and only
its own controller could spend it. These four cards make it a currency:
gained, banned, and spent on things that are not blood.

| Card | What it does to the count |
| --- | --- |
| Ennoia's Theater | **+1**, for a lock, at any moment in the phase |
| King's Rising | **bans** the two counter transfers, for its controller |
| Whispers of the Nictuku | **−4** (+1 pool), for ANY Methuselah, to burn it |
| Inconnu Tutelage | **−4**, for ANY Methuselah, to find any card |

---

## §1 — The four relationships, in one table

The wave is built around the fact that these four differ in *whose*
currency is at stake and in *which direction* it moves. That is what makes
the assertions about each other worth writing: two of the four are used by
Methuselahs who did not play them, and one restricts only the seat that
played it.

## §2 — Gaining transfers: one funnel, two directions

`ops.spendTransfers(n)` already existed for Wider View. A **negative** n
grants, so the count lives in exactly one place and the two directions
cannot disagree about where. `transferAbilities.gain` carries the clause:
`lock` for the price, `burnEdge` for the Mapatano Utando shape not yet in
the pool.

There is **no `transfersLeft` gate** on gaining — that is the whole point
of the clause — and *"can be used at any moment during the influence phase
to get the additional transfer"* [RTR 20180303], so the only limit is the
lock. Ennoia's Theater prints two lock abilities and has one lock, which
makes the card a choice rather than a pair of gifts; the test spends the
transfer and asserts the hand-size offer is gone.

The hand-size half is a **turn-frame** grant
(`docs/temporary-hand-size-design.md`), which is what puts its expiry
*after* the discard phase, as p. 50 requires for Dreams of the Sphinx.

## §3 — King's Rising: a ban that is narrower than it reads

> "You cannot use transfers to move counters to or from your uncontrolled
> minions."

Three things the influence phase offers, and the ban touches two:

- `inf:add` (1 transfer, a pool onto a vampire) — **barred**,
- `inf:take` (2 transfers, a counter back) — **barred**,
- `inf:crypt` (4 transfers + 1 pool, the top crypt card out) — **legal**:
  it spends transfers but moves no counter onto a minion,
- `inf:out` (a full vampire to the ready region) — **legal**, and free
  (p. 36), so it was never about transfers at all.

Both legal cases are pinned, because a ban implemented as "no transfers at
all" would pass a test that only checked the two it does bar.

**What it found: a master that pays out AND stays on the table could not
exist.** `compileMasterCard`'s resolve put the card in play and
`return`ed, so any one-shot effect written beside a `permanent` block was
silently dropped — King's Rising gained nothing at all. The pool payouts
now run before the card enters play, which is also the right order for
reading the board: "if you have 5 **or fewer** pool" is a question about
the pool before the card's own gain.

"If you control the Edge during your unlock phase, burn this card" is
`onAnyUnlock` filtered to the controller's own phase, composed onto
whatever else owns that hook. Three tests: it survives another
Methuselah's unlock, it burns on its controller's, and it stays when the
controller does not hold the Edge.

## §4 — Whispers of the Nictuku: both halves reach past the controller

> "Every Nosferatu burns 1 additional blood to unlock during his or her
> controller's unlock phase. Any Methuselah can burn this card by burning
> 1 pool and spending four transfers during his or her influence phase."

**The surcharge** is a static read over **every seat's** cards in play
(`allEntries`, so an attached copy of the clause would count too) and
applied in the unlock sweep, against the unlocking minion's clan. A
vampire who **cannot pay does not unlock** — the reading recorded here, by
analogy with p. 17's "does not unlock as normal" family and with the
`spendUnlockSink` precedent: a cost that cannot be paid is not paid, and
nothing else happens. **Flagged for the owner**: the alternative reading is
that the surcharge is skipped and the vampire unlocks free, which would
make the card do nothing to a starving Nosferatu. An unlocked vampire is
not unlocking and pays nothing either way.

**The counter-play** is offered to `ctx.seat` — before the controller gate
every other ability in `addLocationAbilities` sits behind — and the payer's
own pool and transfers are what is spent. `abilityAnySeat` is what makes
the engine ask the card at all on somebody else's turn. The test has Bob
burn Alice's card with Bob's currency, and asserts it is not offered on
three transfers.

## §5 — Inconnu Tutelage: an event every Methuselah uses

An **event** sits in one play area and rules the table, so its one ability
belongs to everyone, in their own influence phase. It is one clause with
one price — four transfers **and** a vampire removed from the uncontrolled
region — so it is offered only when both halves can happen, which is the
`cryptDraw` reading beside it.

The search is over the seat's **whole library** (no type filter), and the
searching seat is the *frame's*, not the card's controller — the one place
where a `frame.seat` that reads like a slip is the point. "Find nothing" is
an answer rather than a decline, so the p. 14 shuffle cannot be skipped by
walking away from the question.

"(Discarding and shuffling afterward)" is p. 7's discard-down, and the new
`ops.discardDownToHandSize` funnels to the engine's own
`reconcileHandSizeDown` rather than re-answering the question in a card:
**one question asked in two places will drift**, and this one already had
one caller.

## §6 — What is left in this family

Named here so a later wave does not re-derive them:

- **Mapatano Utando** (101163) — `gain.burnEdge` is built for it, but its
  "lock this card to reduce a bleed against you by 1" needs an in-play
  ability in the bleed-reaction window, which nothing in the pool has yet.
- **Tomb of Rameses III** (101987) — counts the transfers made to one
  chosen uncontrolled vampire, which needs a per-transfer hook.
- **Brainwash** (100245) — bars transfers to a *single* uncontrolled
  minion in the **prey's** region, so it needs a card attached to another
  seat's uncontrolled vampire.
- **Social Ladder**, **Grand Temple of Set**, **Gather** — influence-phase
  cards that are not about transfers.
