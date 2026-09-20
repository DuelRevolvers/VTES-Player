# The armour cards

Wave 72 (2026-09-19). Skin of Rock (101791), Resilience (101608),
Skin of Steel (101792), Unflinching Persistence (102071),
Skin of Night (101790).

Five [for] cards about **taking** damage. Four are existing prevention
vocabulary; the fifth converts aggravated damage to normal, which is the
wave's one new primitive. The wave's value is not the five cards — it is that
a ruling makes two of them interact, and that the fifth card walked straight
into a **recorded deviation** the project had been carrying since the
prevention-credit machinery was built.

---

## §1 — What each card is

| Card | Basic | Superior |
| --- | --- | --- |
| Skin of Rock | prevent 1 | prevent 2 |
| Resilience | prevent 1 | prevent 3 **non-aggravated** |
| Skin of Steel (1 blood) | prevent all from the strike | …and all from their strikes this round |
| Unflinching Persistence | prevent 1 | maneuver, **and** prevent 1 later this round |
| Skin of Night | treat aggravated as normal this round | …**and** prevent 1 |

Skin of Steel's superior is exactly Rolling with the Punches' superior, whose
round-scoped prevention already covers the strike being resolved — so "as
above, **and** …" needs no second effect. Its 1 blood is the card's own cost,
not the extra blood that some `preventAllThisRound` cards charge on top.

## §2 — Resilience: the superior is the WEAKER mode

"Prevent 3 non-aggravated" is worth less than "prevent 1" against an
aggravated hit, which is worth **nothing**. The `nonAggravated` gate already
existed (Soak, Wall of Filth) and it hides the option rather than letting it
resolve to zero.

The assertion that matters is the pair: against aggravated damage the
**superior is gone and the basic is still there**. A test that only checked
the superior had vanished would pass just as happily if the gate had taken
the whole card off the table — which is the shape of gate bug this project
has paid for repeatedly.

## §3 — Skin of Night, and the ruling that shaped it

> "[for] This vampire treats aggravated damage as normal damage for the
> remainder of this round."

The obvious implementation is to clear `PendingDamage.aggravated`. **It is
wrong**, and a ruling on the card beside it in this wave says so:

> "[FOR] Cannot be used to prevent aggravated damage, **even if the minion
> treats them as normal damage** (eg. Skin of Night)." — Resilience
> [LSJ 20040812-2]

So the damage does not stop being aggravated. What changes is only what
*applying* it does. The conversion is therefore recorded on the MINION
(`CombatFrame.aggravatedAsNormalRound`), and the only place that asks is
`applyResolvedDamage` — the one site where "aggravated" means "cannot be
mended, and a ready vampire goes straight to torpor" (p. 34).

Two consequences fall out for free, which is the sign the fact is in the
right place:

- Resilience's superior stays gated out after the conversion, because the
  gate reads the item and the item is untouched. The ruling is honoured **by
  construction** rather than by a special case.
- The flag is keyed by **minion, not by side** — unlike its neighbours
  `handStrikesAggravated` and `firstStrikeRound`. A retainer takes damage in
  the same window as the vampire it is on, and a side-keyed flag would
  convert the retainer's damage too.

Skin of Night's basic mode prevents nothing, so it is **not offered against
damage that is already normal** — there is nothing for it to do. The
superior also prevents 1, so it is offered either way, and it reaches the
option list through the ordinary `prevent` gate rather than through the
conversion branch.

## §4 — What the wave found: a credit that forgot two things

Unflinching Persistence's superior grants a prevention **credit**, and that
turned out to be the first card of its kind to matter. Two defects, both live
before this wave, both found by one card:

### The credit outlived its own sentence

`combatCredits.prevent` is documented in `spec.ts` as "**this round only**"
— and `grantPreventCredit` wrote it into `CombatFrame.preventCredits`, which
is the **combat-long** pool. So Obedient Flesh's and Bear's Skin basic's
credits had always survived into later rounds.

The tell was already in the tree: the test covering Bear's Skin basic is
named *"inferior is the existing ROUND-scoped credit … gone next round"* and
its body asserted `preventCredits`, the combat-long field. **A test whose
name claims more than its body is the same family as a guard clause that
silently skips** — the name was right and the assertion pinned the wrong
field, so nothing ever disagreed.

There is now a `preventCreditsRound` pool, reset at the round boundary beside
`preventAllFrom`, and the spend order is shortest-lived first: the round-1
pool, then the per-round **rate** (which refreshes, so spending it is free),
then the round pool, then the combat pool.

### The credit could not be Discipline-filtered

`tests/cards/discipline-filtered.test.ts` carried an explicit **recorded
deviation**: a credit is a bare count, so it has forgotten which card granted
it, and "this damage cannot be prevented by cards requiring Fortitude"
(Blood Fury, Soul Burn) cannot reach it. The note said this was safe *only
while no credit-granting card required a Discipline the filters name* —
Obedient Flesh requires [dom][pro], and the filters name [for].

**Unflinching Persistence requires [for].** The deviation's own precondition
expired the moment the card was admitted.

Each entry in the round pool now carries the disciplines its granting mode
required, so the filter reaches a credit exactly as it reaches a card, and
the option is not offered. The old test is rewritten to assert what still
needs guarding: that **every** `combatCredits.prevent` mode names a
discipline, because a mode naming none would put an anonymous point back in
the pool and be unfilterable again, silently.

This is the "**a deferral is a claim about the code as it was**" lesson
pointing the other way: a recorded deviation is a claim about the CARD POOL
as it was, and a wave can invalidate one without touching the code the note
described.

## §5 — A third thing, about testing the card

Unflinching Persistence's superior **maneuvers**, so playing it opens the
range — and a hand strike at long range inflicts nothing (p. 29). The damage
window never opens, and the credit the card just granted has nothing to spend
on. Every assertion about the credit passed against an **empty option list**
until the fixture had Bob close the range back with a maneuver credit.

Two of those assertions were negatives (`not.toContain("prevent:credit")`),
which is the purest form of the project's oldest lesson: a negative against
an empty list is not a test. They now assert `pass` is on the table first, so
the window is provably open before anything is said to be missing from it.
