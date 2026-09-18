# Playing a card that is not in your hand

Wave 62 (2026-09-17). Gift of Proteus (100827), Storage Annex (101877).

A store is a pile of cards held **out of play** on a card in play —
neither hand, nor library, nor in play (`PermanentInPlay.stored`,
`docs/library-search-design.md` §5). The zone already existed. What this
wave builds is the other half of it: **playing a card back out of one**,
and doing it by the rules the card actually prints.

---

## 1. The family, and how much of it the V5 pool can hold

Eight legacy cards print a face-down store. Only two of them can do
anything in a V5-only pool:

| Card | State |
| --- | --- |
| Gift of Proteus | **in** — Protean and Gangrel are both in the pool |
| Storage Annex | **in** — clanless, typeless, takes any card |
| Mokolé Blood | inert: no Serpentis card and no Serpentis vampire exists (§7) |
| Blessing of the Beast | inert: Ahrimane, a clan no V5 vampire has |
| Père Lachaise, France | inert: burnt vampires are not modelled in the ash heap (`docs/ash-heap-design.md`) |
| Light Intensifying Goggles | deferred: needs an aim-card capture hook and a first-round-only maneuver credit |
| Inceptor | deferred: needs "play other copies as if at superior", and its only legal bearer is a token vampire |
| Research | pointless: its "research area" is read by no card in the pool |

**Check the pool before building, not after.** Mokolé Blood was written,
compiled, tested against and then pulled — §7.

---

## 2. "As if from your hand" is the ORDINARY play enumerator

The engine has exactly one place that turns cards in hand into play
options: `handlerOptions(seat, window)` in `engine.ts`, which asks each
card's own handler what it offers in the window being decided. The store
now feeds the same loop:

```
for each card in play whose handler declares `storePlay`,
  controlled by this seat,
    for each card on it, ask its handler for options in THIS window,
      keep the `playCard` ones the store's filter allows.
```

Everything follows from the card's own handler, which is the point:

- a stored **combat card** is offered in the strike window,
- a stored **ally or equipment** announces the employ or equip **action**
  it would have announced from hand — blockable, paid at resolution,
- a stored card with two modes is offered at both, with the requirements
  the bearer actually meets.

`CardHandler.storePlay` carries the filter: `bearerOnly` for "**this**
Gangrel can play these cards", `clan` for "Tzimisce you control can play
cards from this location", and `burnWhenEmpty`.

### What this replaced

The previous route was an ability of the store —
`ability:<store>:<id>:play:…` — which called `playCardFromHand`, offered
only in `turn.minion`, and could only ever bring a **permanent** into
play. Three shipped cards used it (Fleshforge Chamber, The Erciyes
Fragments, Delivery Truck), and for all three it was half right:

- **The Erciyes Fragments takes any library card from the prey's ash
  heap.** A combat card or an action modifier taken that way could never
  be played at all — the card was partial, and nothing could have caught
  it: `no-partial-cards` asserts over specs, not over reachability.
- **Fleshforge Chamber's ghoul arrived without an action.** Employing an
  ally is an action (p. 27); the old route put it straight into play,
  unblockable and paid at once. `playCardFromHand`'s own comment reasons
  that "there is no action to block in this family" — true of the Piper
  family it was written for, borrowed by a family it is false of.
  **A new call beside an existing one copies its guards before its shape.**

Both are fixed by having one route instead of two.

---

## 3. The one thing the pile changes

`playCard` looks for the option's card in hand and, failing that, in a
store that grants play (`storeHolding`). From there the code is the same
code: cost, the once-per-turn and per-combat records, the as-played
window, cancels, resolution, the ash heap.

The single divergence is the **replacement draw**. "Draw a replacement
card" (p. 8) refills a *hand*; a card that was never in one leaves no gap,
so the whole delayed-replacement chain is skipped. That is a guard around
all six branches rather than inside each — every branch there is a
question about *when* the replacement comes, and the answer here is that
there is none.

"Burn this card if it has no cards on it" is checked the moment the store
loses the card, after the play is on record: it was played, so the store
lost it **even if the play is cancelled**.

---

## 4. Filling a store one card at a time

`fillOnEntry` gained `from: "hand"`. "Any number of cards requiring
Protean from your hand" is a subset of the hand, and the existing
`searchStore` answer shape is a **power set** — fine for "up to three
searched cards", not for a hand.

So the hand fill raises a `fillStore` ChoiceFrame per card: pick one, and
the frame re-raises with `left` decremented until the count runs out or
the answer is "put no more on it". `count: "all"` never decrements.

Two details the cards force:

- **`requires`** — "cards requiring Protean [pro]" is a test on the card's
  *printed requirement*, which is per mode, so all three modes are asked
  (a card requiring [pro] only at superior still requires Protean).
- **`mandatory`** — Storage Annex says "PUT a card from your hand on this
  card when you play it". There is no "find nothing" answer while nothing
  has been put on yet. An empty hand leaves an empty option list, and a
  non-optional frame with nothing to choose pops harmlessly.

The frame is **not** `optional`: declining an optional frame pops it
without calling `applyChoice`, which would skip the end-of-sequence work
(the burn-if-empty, and a library shuffle when a future zone needs one).
"Put nothing on it" is an answer, not a decline — the same reason
`searchStore` is written that way.

---

## 5. What the wave found: `onEnterPlay` never fired for a card that puts ITSELF in play

Gift of Proteus fills its store from `onEnterPlay`, and the store stayed
empty. `notifyEnterPlay` — documented as firing "from both entry paths" —
is called by `enterPermanent` and by the equip/employ/recruit pipeline.
But the two **action** paths in `resolveCardAction` emit
`PermanentEnteredPlay` themselves and returned:

- `putsInPlayOnSuccess` — "+1 stealth action. Put this card in play with N
  counters" (Under Siege and the counter actions),
- `attachOnSuccess` — "Put this card on this vampire" (Heart of the City,
  Preternatural Strength, the Fee Stakes, Tier of Souls).

Every card that puts itself in play on a successful action has arrived
without its own arrival hook since the hook existed. It cost nothing until
now only because no such card had an arrival clause. This is the third
time this exact omission has been found — the ally path had it (fixed when
Rotting Behemoth needed it), the token-vampire path has it right, and
these two were written beside them without it.

**Machinery documented as general quietly does not apply to one case.**
The tell each time: the path emits the entry event *itself* instead of
going through the shared entry helper.

---

## 6. A store with no play permission is the negative control

Storage Annex holds a card that **nobody** may play — the only way back is
the master-phase exchange, one hand card for the one stored card. In the
code that is a single absent field (`playableFrom`), and in the test it is
a single absent option. Having the two cards in one wave is what makes
either assertion mean anything: the same zone, the same fill, and the
difference between "offered to its bearer in every window" and "offered to
nobody" is one line of spec.

The exchange gives the stored card back **first** and stores the chosen
card second. The other order would briefly put two cards on a store that
holds one, and the cap is checked at enumeration, not at apply.

---

## 7. Mokolé Blood: built, then pulled

"Search your library and/or ash heap for up to four cards requiring
Serpentis [ser]." The V5 pool contains **no card requiring Serpentis and
no vampire with the Discipline** — V5 gives the Ministry Protean where the
legacy card pool gave the Followers of Set Serpentis. The store can never
be filled, so `burnWhenEmpty` burns the equipment the instant it is
equipped: a card that is whole, does exactly what it prints, and does
nothing at all. §0 keeps those out of the pool.

It was written first and checked afterwards, which is the lesson it now
illustrates: **before implementing a card that filters on a clan, title,
sect, card type or DISCIPLINE, check the pool contains one.** The
discipline case is new — the earlier instances (Tradition Upheld's
Caitiff, Gangrel Justicar's Camarilla Gangrel) were all clan filters.

The `searchOrAshHeap` fill written for it was removed with it. An unused
member of a union is a member no test covers; the sequential fill it
shared is what survives, and a later card that searches two zones adds the
zone back to one list and one apply.
