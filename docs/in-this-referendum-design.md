# In this referendum — design (wave 94)

Three political actions whose **own referendum changes who votes and how much**.

| Card | KRCG | "In this referendum, …" | Payout |
| --- | --- | --- | --- |
| Eat the Rich | 100605 | each priscus −1 ballot, each non-priscus titled vampire −1 vote, burning the Edge worth +1 vote | each chosen Methuselah burns 1 pool, +3 if they control a ready titled vampire |
| Investiture | 101003 | each ready cardinal +1 vote; Camarilla vampires cannot vote | the chosen Sabbat vampire becomes a priscus |
| Praxis Seizure: Istanbul | 101463 | each ready Assamite +1 vote | Prince of Istanbul; if they are not an Assamite, lock all Assamites |

Printed text read from `data/vtes-raw.json`.

## 1. What was already there

Nearly all of it — and it was in three places:

- `ReferendumFrame.voteModifiers` — a per-vampire count change for one referendum,
  clamped at zero (Absolute Tyranny, Fee Stake). Already had `titledOnly`.
- `titleGrant`'s `voteBonusClan` — "each \<clan\> gets +1 vote" as a granted,
  castable vote per matching ready vampire (the eight Justicars), written inline
  in a bespoke helper.
- `ReferendumFrame.voteRestriction` — "only \<sect\> may vote" (the ballot cards).

## 2. One helper, one declaration

`CardSpec.referendumRiders` declares a card's "in this referendum" clauses, and
`applyReferendumRiders(frame, state, riders)` in `compile.ts` applies them as the
referendum opens. **The Justicars' `titleGrant` was re-pointed at the same
helper**, so "each \<clan\> gets +1 vote" is no longer written twice — the
drift lesson applied before it could bite. Four riders:

| Rider | Card | Mechanism |
| --- | --- | --- |
| `voteBonusClan` | Istanbul, the Justicars | a granted vote per ready vampire of the clan |
| `voteBonusTitle` | Investiture | the same grant, keyed on a title |
| `titledVoteDelta` | Eat the Rich | `voteModifiers` with `titledOnly` |
| `edgeVoteBonus` | Eat the Rich | new `ReferendumFrame.edgeVoteBonus`, added where the Edge's vote is offered |
| `voteBanSect` | Investiture | new `ReferendumFrame.voteBan`, the inverse of `voteRestriction` |

`voteBan` is a second field rather than a sign on `voteRestriction` because "only
X may vote" and "X may not vote" are different tables. Both bar *vampires*
casting; the Edge, the calling card and granted votes are Methuselah sources and
are untouched.

On spec-compiled cards the riders are **grafted** onto `referendumSetup` — the
Fee Stake's `refVoteModifier` claims the same hook with an assign-if-absent, and
a second assignment would have silently replaced it — and they are skipped for a
`fromCardInPlay` referendum, which is somebody *else's* referendum about the card.

## 3. Eat the Rich: two sentences, one rule

"Each priscus gets −1 ballot, each non-priscus titled vampire gets −1 vote" reads
as two rules and is one in this engine. `docs/ballots-design.md` settled that a
priscus's ballot is tallied through the vote machinery (priscus is 1 in
`TITLE_VOTES`), so every titled vampire's count simply drops by one, clamped at
zero. Implementing it as two modifiers would have double-charged nobody and
explained nothing.

The payout is `refChooseSeatsBurn` with a new sibling to `capBonus`:
`titledBonus` — "+3 if they control a ready TITLED vampire" — asked of the same
ready vampires.

Its twin, **Free States Rant**, prints the identical vote clause and stays out:
it allocates points among **vampires**, and the only allocation primitive
(`refAllocateBurn`) allocates among seats.

## 4. Istanbul, and a correction to wave 93

Wave 93 recorded Istanbul's blocker as "a per-referendum clan-vote rider". That
understated it: the card also prints **"and if this vampire is not an Assamite,
lock all Assamites"**. The rider regex that listed the Praxis riders stripped
everything up to the city, and this clause is in the same sentence as the city.
Reading the whole text again is what found it — the wave-93 lesson ("re-derive
from the text") applied to the wave that wrote it.

`refPutInPlay.lockAllOfClanUnlessBearer` locks every seat's ready, unlocked
vampires of the clan once the title lands, unless the new prince is one. The clan
is the **registry's** — Assamite is Banu Haqim, the clan-name lesson.

**Venice** prints the same two riders for **Giovanni** and stays out: whether the
V5 Hecata answer to "Giovanni" is the owner's call.

## 5. Tests

`tests/cards/in-this-referendum.test.ts` — 10 cases. A vote rider is only
observable at the **polling step**, so each card is asserted there — the vote
counts offered — as well as by its payout.

- Eat the Rich: the prince casts 1 instead of 2 and the Edge 2 instead of 1,
  against a **control** — Empires Fall, the same `refChooseSeatsBurn` shape
  with no riders — where the same prince and Edge cast 2 and 1. The payout
  charges a titled seat 4 and an untitled one 1.
- Investiture: the Camarilla prince is offered no vote; a cardinal's seat gets
  +1; a seat with **no** cardinal gets nothing (the case that catches a bonus
  keyed on "any ready vampire"); the title lands; a bishop cannot play it.
- Istanbul: a Banu Haqim's seat gets +1; a Ventrue prince locks every ready Banu
  Haqim at the table, and **the twin**, a Banu Haqim prince, locks nobody.

Mutation-checked four ways — the Edge bonus, the vote ban, the lock's clan
condition and the cardinal filter — each failing only its own case. The last one
was caught only by the no-cardinal assertion, which was added for exactly that.

The wave-93 test that pinned "Istanbul is still out" failed by design and now pins
the new reason: Venice alone remains, on the Giovanni question.

Fuzz: all three added. `simulate:politics` also run (0 errors), as CLAUDE.md asks
for referendum work.

## 6. Counts

Library 851 / crypt 217 / total 1068; supported 950 / 1068.
