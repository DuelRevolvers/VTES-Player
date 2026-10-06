# Stealable locations — design (wave 92)

Two locations whose own text invites theft, and the action that steals any cheap
location.

| Card | KRCG | Cost | Text |
| --- | --- | --- | --- |
| New Management | 101280 | — | Do not replace until after this action. Ⓓ Take control of a location that is free or costs 1 blood or pool. |
| The Line | 101110 | — | Unique location. You can lock this location to reduce the cost of an action card a vampire you control plays by 1 blood (this location is not locked if that card is canceled as it is played). Vampires can steal this location as a Ⓓ action. |
| The Louvre, Paris | 101127 | — | Unique location. You can lock this location to lock a Toreador. If you control the Prince of Paris, you can lock this location to lock a minion. Minions can steal this location as a Ⓓ action. |

Printed text read from `data/vtes-raw.json`.

The **cost filter on the thief** is what ties the three together: both locations
are free, so New Management may take either — and a location that costs 2 is
exactly what it may not. The two locations then differ in *who* may steal them
("vampires" against "minions"), which is the pair's negative space.

## 1. What the wave found: four of the first six cards were inert

This wave was designed twice. The first plan — the action-side counterpart of wave
91's control-taking masters — was Legend of the Leopard, New Management and
Puppeteer, and three engine extensions were written for it before the check that
the rhythm puts **first** turned the plan over:

| Card | Why it cannot be played in this pool |
| --- | --- |
| Legend of the Leopard | Its **Osebo** clan icon is a requirement on a minion card (p. 10); the V5 crypt has no Osebo. |
| Puppeteer | An ally requiring **Necromancy** to recruit; no V5 vampire has it. |
| Lure of the Serpent | Requires **Serpentis**. |
| Restructure | Requires **Dementation**. |

The V5 crypt's disciplines are exactly `ani aus cel dom for obf obl pot pre pro
tha`. A card requiring anything else is inert here however completely it is
built, and §0 keeps inert cards out.

**All three extensions were reverted** — `actionSteal.from: "predatorOrPrey"`,
`actionDamageMinion`'s kind/relation filters, and a `borrowMinion` granted-action
arm. Each would have compiled, passed, and been read by nothing. That is the dual
of wave 88's lesson (a spec field with no *reader* is a partial card): a field
with no *writer* is vocabulary that claims a capability the pool never exercises,
and the next reader of `spec.ts` would build on it.

The lesson is the rhythm's step 1, and it was skipped because the plan was built
from a **text search** ("take control of"), which knows nothing about clan icons
or discipline requirements. Filter a candidate list by the V5 crypt's clans and
disciplines *before* reading any card text.

## 2. The Line: a cost source that pays from nowhere

The pool already had **cost sources** (`PermanentCostSource`, Ravnos Cache and
Carnival): a card in play that pays part of a play's cost from its counters. The
Line is the same idea with no counters — a fixed 1 blood, bought with a lock. So
it is one new field, `flat`, and **one read** for it:

`costSourceAvailable(entry)` in `derived.ts` answers "how much can this source
pay now" — `flat` if present, otherwise its counters. The OFFER
(`paymentSplits`) and the SPEND (`spendCostCounters`) each used to read
`entry.counters` on their own; a flat source made that a question with two
answers, so both now call the helper. A flat source's spend takes no counters.

**The parenthetical asks for nothing.** "This location is not locked if that card
is canceled as it is played" is already true: an action card's cost is paid at
RESOLUTION (p. 27), so a card canceled as it is played never reaches the spend,
and the location is never locked. The sixth parenthetical in this project that
describes rules rather than asking for code.

**One behaviour change outside the wave, stated plainly:** the spend now skips a
*locking* source that is already locked when the action resolves. The offer
always skipped it; the spend did not, so a source locked by something else
between announcement and resolution still paid. For Ravnos Cache the counters
capped that; for a flat source it would have paid from nothing, every time. The
card text ("lock this location to…") supports the skip — a locked card cannot be
locked.

## 3. The Louvre: an untimed lock

"You can lock this location to lock a Toreador" prints **no timing**. The project
has already taken this reading once, for Dreams of the Sphinx
(`temporary-hand-size-design.md`, citing The Barrens ruling): offered in every
window its controller has an impulse in. The Louvre follows it, with one stated
difference — it is also offered in the action windows of the controller's **own**
actions, because locking a would-be blocker before blocks are declared is what
the card is for (a locked minion cannot block, p. 25). It locks itself on use, so
windows that re-offer cannot farm it.

"If you control the Prince of Paris, … a minion" lifts the clan filter while a
**ready** vampire you control holds `title: "prince"` with `titleCity: "Paris"`.
The clause is reachable: Praxis Seizure: Paris grants exactly that. A prince of
another city does not widen it, which is asserted.

The Toreador icon on The Louvre is on a **master**, so it is not a requirement —
p. 10's clan-icon rule is about minion cards.

It is the second `permanent` clause added under the wave-88 rule, and it went in
the destructure **and** the install guard in the same edit.

## 4. Deferred, with the blocker named

- **The Shard, London (102244)** — "reduce the cost of **a card you play**", only
  while you hold the Edge. Cost sources are wired into the action and equipment
  payment paths only; "a card" means masters, combat cards and reactions too,
  each of which pays at a different moment. That is a change to every payment
  path, not a card.
- **High Museum of Art, Atlanta (100926)** — gain 4 pool on gaining control, burn
  4 on losing it "including when it … becomes contested". Whether *winning back*
  a contested copy counts as "gaining control" is a rules question for the owner,
  and `ContestBegan` fires no handler hook today.

## 5. A boundary trap recorded in passing

`grantedAction.maxCapacity` is **exclusive** ("less than N", Young Bloods) while
the referendum primitives' `maxCapacity` is **inclusive** ("below 7" is `6`).
Same name, opposite boundary. It bit nothing this wave — the card that would have
used it was inert — but the field's doc now says so, because the next user will
reach for the sibling's reading.

## 6. Tests

`tests/cards/stealable-locations.test.ts` — 11 cases.

New Management is offered the free location and refused both a 2-pool location
(Inbase Discotek) and the player's own; it resolves as a directed action at the
controller. The Line pays an action card's 1 blood and locks, against a control
paying the ordinary way; a locked Line is not offered; playing it from hand
denormalizes the flat cost source onto the entry; and vampires may steal it where
an ally may not. The Louvre offers only Toreador and locks both itself and the
target; the Prince of Paris widens it to any minion and a prince of another city
does not; and an ally may steal it.

Mutation-checked three ways — the cost filter, the flat amount, and the Prince
widening — each failing exactly its own case.

Fuzz: all three added.

## 7. Counts

Library 834 / crypt 217 / total 1051; supported 933 / 1051.
