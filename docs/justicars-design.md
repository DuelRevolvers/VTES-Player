# The clan Justicars (wave 60)

*2026-09-17, platform v0.10.51. Library 706 → 712.*

**Cards:** Banu Haqim Justicar (102268), Brujah Justicar (100262),
Lasombra Justicar (102272), Nosferatu Justicar (101299), Tremere Justicar
(102021), Ventrue Justicar (102111). Plus a fix to the two already in the
pool: Malkavian Justicar (101154) and Toreador Justicar (101990).

## §1 The family

> *"Title. Choose a ready \<clan\>. Successful referendum means this card
> is put on the chosen \<clan\> to represent the unique Camarilla title of
> \<Clan\> Justicar. In this referendum, each \<clan\> gets +1 vote."*

Eight names, one shape — the **Praxis Seizure treatment**. `titleGrant()`
had carried all of it since wave 13 (hold the card aside, grant on a pass,
burn on a fail, seed `voteGrants` for the rider), and two cards were using
it. The wave is a table.

`JUSTICAR_CLANS` builds **both** the specs and the handlers, so neither
list can gain a card the other has not — the failure mode that let two
Justicars sit in the pool for forty-seven waves missing the field in §3.

Three cosmetic differences that are not differences at all: "if this
referendum passes" / "is successful" / "successful referendum means" are
one thing, and so are "each ready Brujah" / "each Tremere" / "each Banu
Haqim" — only a ready vampire casts votes (p. 28), so the helper's
`isReady` filter is right for all three phrasings.

## §2 The one real difference: the Camarilla clause

Four print *"choose a ready **Camarilla** \<clan\>"* (Banu Haqim,
Lasombra, Malkavian, Gangrel) and four print *"choose a ready \<clan\>"*
(Brujah, Nosferatu, Toreador, Tremere, Ventrue — Ventrue's V5 crypt is
Camarilla anyway, which is exactly why the flag has to come off the card
and not off the clan).

It is a real gate in this pool. Sabbat Lasombra, Sabbat Tremere, Sabbat
Nosferatu and Sabbat Banu Haqim all exist in the V5 crypt, so
`camarillaOnly` decides whether they can be made justicar. The tests
assert it both ways with the same fixture.

## §3 What it found: two Justicars shipped without `unique`

*"The **unique** Camarilla title of Malkavian Justicar."*

The card-control contest (p. 17) gates on `registry[name].isUnique`, and
neither Malkavian Justicar nor Toreador Justicar set `unique: true`. Two
copies of the same Justicar could sit on the table with no contest raised
— and the second copy could be played from hand at all, since the
"you already control one" gate reads the same flag.

**This is the Praxis Seizure lesson, verbatim, in the card family right
next to it.** Wave 13 found that Praxis Seizure prints "this could lead to
a contested title" and that the engine's contest gates on a flag the card
did not set; the fix went into `praxisSeizure()` and the Justicars beside
it went without. *"Twice now the fix went into one enumerator while a
sibling went without"* — this is the third time, in a card factory rather
than an enumerator.

What makes it hard to see: the **title** contest was already correct.
`titleContestKey` keys `justicar` on the vampire's clan and has done so
all along, so two Brujah Justicars in play would contest their TITLES
while their CARDS did not. Half-right is the worst state for this kind of
bug, because the obvious test — "do two justicars of one clan fight?" —
passes.

`unique: true` is now generated from the table for all eight, and
`tests/cards/justicars.test.ts` pins it by name so a ninth cannot arrive
without it.

## §4 Gangrel Justicar is INERT, and stays out

Gangrel Justicar (100806) prints *"choose a ready **Camarilla**
Gangrel"*, and **every Gangrel in the V5 crypt is Anarch** — 14 of 14.
The card would be built, tested, passing and unable to do anything, which
is the Tradition Upheld shape (§0: a card can be whole and still be
inert, and the pool wants neither).

It costs nothing the day a Camarilla Gangrel group opens in §7. This is
also the answer to why the `camarillaOnly` flag could not be inferred from
the clan: it is the clause that makes one card of the eight unplayable.

## §5 Tests

`tests/cards/justicars.test.ts`, 4 cases — the wave's three real
questions, not eight repetitions of one card:

- all eight specs carry `unique` (§3), checked by name;
- Ventrue Justicar grants the title and the rider supplies the one vote
  that passes the referendum — the caller is deliberately **untitled**, so
  a vote cast at all can only be the card's own;
- Lasombra Justicar offers the Camarilla Lasombra and **not** the Sabbat
  one;
- Tremere Justicar offers **both**, because it does not print the clause.

There was no Justicar scenario test at all before this wave; the two in
the pool were covered only by appearing in the fuzz decks.

## §6 Left behind

**Gangrel Justicar** (§4). The other Camarilla-acceptance politicals
nearby — Ravnos Acceptance, Giovanni Acceptance, Revocation of Tyre,
Invitation Accepted — are sect CHANGE, a recorded out-of-scope deviation.
