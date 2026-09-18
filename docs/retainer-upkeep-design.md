# Retainer upkeep

Tranche 3, wave 43. Library **645 → 648**. Three retainers whose whole
text is a **phase** — the first wave outside Equipment since 38.

| Card | KRCG | Printed |
|---|---:|---|
| Faithful Servant | 100692 | Mortal, 1 life. A torpid employer gains 1 blood **at the beginning of their minion phase**. |
| Fortune Teller | 100776 | Mortal, 1 life. **During your minion phase**, look at one card picked **at random** from your prey's hand. |
| Robert Carter | 101644 | Unique ghoul, 1 life. **During your unlock phase**, the employer burns 1 blood **or Carter is burned**. +2 bleed. |

## §1 — The phase-hook family had a hole, and a hook that did not reach

Picking these three was picking a family by the window they fire in, and
the window turned out to be half-built.

`CardHandler` had `onMasterPhase`, `onInfluencePhase` and `onDiscardPhase`
— each fired as its phase OPENS — plus `onMinionPhaseEnd`, added in wave
32 and explicitly documented as *"the only one that fires as a phase
CLOSES"*. **There was no opener for the minion phase.** `tf.phase =
"minion"` was a bare assignment with nothing hung off it, which is
invisible until a card says *"at the beginning of his or her minion
phase"*. `onMinionPhase` now fires there, over `allEntries()`.

**And `onMasterPhase` was iterating `seat.permanents`.** That is the
documented lesson — *"a hook that iterates `seat.permanents` does not
exist for attached cards"* — still live in the tree, in the very hook
whose doc comment describes it as firing "for every card in play". Every
crypt ability and every retainer is attached, so for those cards the hook
did not exist at all. It was latent only because no attached card in the
pool used it yet; the retainer being added three lines away is exactly the
card that would have found it the hard way.

This is the third time this bug has been fixed in a different hook
(`onAnyUnlock` found by Fame, then `onBleedSuccess`). The standing advice
— *when you add a hook, check every path that should reach it* — has now
earned a corollary: **when you add a hook to a family, re-read the
siblings.** They were written at different times by the same hands and
they do not agree.

## §2 — Faithful Servant

`torporBloodAtMinionPhase`, on `onMinionPhase`, gated on the EMPLOYER's
own phase — *"his or her minion phase"* names the controller's, not
whoever is unlocking. Automatic: the card says "gains", not "you can", so
nothing is offered. Withheld at capacity, which is the futile-option rule
rather than a card condition.

## §3 — Robert Carter, and a question worth asking

*"During your unlock phase, Carter's employer burns 1 blood, or Carter is
burned"* is a genuine two-answer choice — the first recurring upkeep in
the pool that a player may simply decline.

It raises a `ChoiceFrame` **only while the employer can pay**. With no
blood there is one legal answer, and a frame with one answer is a frame
nobody should be given: the retainer is burned outright. That also keeps
the settle loop honest, which is how The Rack's empty-hand frame hung the
fuzz.

`onAnyUnlock` already reached attached cards (fixed when Fame found it),
so this half needed no engine work — the contrast with `onMasterPhase`
three lines away is the whole point of §1.

*"Ghouls are monsters, not mortal"* [ANK 20200203-2] [LSJ 20060515], so
the tag is `ghoul`, not `mortal`. That matters to every card that names
one kind or the other, and the two Fortune-Teller-shaped cards beside it
are `mortal`.

## §4 — Fortune Teller, and the knowledge model

*"Look at ONE CARD PICKED AT RANDOM from your prey's hand."*

The knowledge model was built for Revelations
(`docs/knowledge-design.md`): `GameState.knowledge` maps a seat to the
card **instances** it has seen, written by a `CardsRevealed` event, and
`redactFor` unmasks a known card in somebody else's hand. Everything that
used it so far revealed a **whole hand**. This is the first card that
reveals exactly one, and the first where **which** card is a die roll.

The pick goes through `ops.randomIndex` — the card→engine boundary that
exists so no card reads `state.rngState` itself — so a replay sees the
same card. `Math.random` here would have broken determinism in a way the
fuzz would eventually have caught and nothing else would.

The look is recorded at the moment it happens, not in the option list: an
option list is a pure read and gets computed more than once. That is the
same reasoning `peekAndDiscard` records in its own comment.

Once each phase, via `entry.usedThisPhase`, and withheld entirely while
the prey's hand is empty.

## What the wave found

**A missing member of a hook family, and a sibling with the bug the
project has now fixed three times.** Neither would have surfaced from
reading the card: both came from asking "which window does this fire in?"
and finding the window half-wired.

Worth noting what did *not* need building. The knowledge model, the
seeded `randomIndex` boundary, `onAnyUnlock`'s attached-card reach and the
`ChoiceFrame` machinery were all already right, and three of those four
are right *because* an earlier wave found them wrong.

## What is left

18 T1 retainers. Several are inert by §0 and stay that way until §7 opens
their clans — **D'habi Revenant** (Baali), **Giuseppe, Gravedigger**
(Necromancy, which no card in the pool requires), and the
Gargoyle- and Laibon-gated ones. The next buildable cluster is the
retainers that change what a COMBAT is (Nar-Sheptha's *"the opposing
minion is considered the acting minion"*).

## Tests

`tests/cards/retainer-upkeep.test.ts`, 5 tests, three of them negative: no
blood for an employer who is not in torpor, no question for an employer
who cannot pay, and no second look in the same phase.
