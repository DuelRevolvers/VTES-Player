# A second minion helps the action through

Tranche 3, wave 27. Three action modifiers played on the acting side by a
minion that is **not the actor**.

| Card | KRCG | Printed |
|---|---:|---|
| Suppressing Fire | 101907 | "Only usable by a ready unlocked minion **with a gun** other than the acting minion. **The blocking minion gets −1 intercept.**" |
| Zapaderin | 102204 | "Only usable by a ready unlocked **Ravnos** other than the acting minion. Allies and vampires **younger than this modifying Ravnos** get −1 intercept." |
| Stealth Ritus | 101867 | Requires a ready Sabbat vampire, as the action is announced. "**Choose another ready Sabbat vampire you control. The chosen vampire burns 1 blood, or this card has no effect.** +1 stealth, even if stealth is not yet needed." |

A Methuselah's other minions paying into an action they are not taking.
*"Can only be played by the controller of the acting minion"*
[LSJ 19990425] needed no clause: that is what an action modifier is
(p. 12).

## §1 — Suppressing Fire needed no new effect at all

`modifyBlockerIntercept` **already existed** — Forced Confessional,
Relentlessness and two others use it, with a legality gate that already
asks both questions the card needs (a live block attempt, and one the
blocker would otherwise win). I wrote a second copy of it before checking,
and the typechecker caught the duplicate. *"It already exists" is a claim
to CHECK, not to make* — and so is its opposite.

What was genuinely new is **who may play it**: "a minion **with a gun**".
`requiresAttachedTag` is a `meetsRequirements` clause reading the tags the
equipment compiler already sets — not a discipline, not a clan, a piece of
equipment. `byOtherUnlockedVampire` covers the rest, and is worth a note:
despite the name it does not test `kind`, so it already admits allies,
which is what this card wants ("minion", not "vampire").

## §2 — A yardstick that is not the actor

`ActionInterceptModified` already carried a filter with a `youngerThan`
minion id, and `modifyFilteredIntercept` already built the "allies **and**
younger vampires" union. But the id was hard-coded to `af.acting`, and
`blockerMatchesFilter` only resolved it when the minion handed to it *was*
the actor — every card that had ever used it measured against the acting
minion.

Zapaderin measures against **the Ravnos who played it**, who by the card's
own first sentence is not the actor. Two small changes: the spec's
`youngerThanPlayer`, and a lookup in `currentIntercept` that resolves
whoever the filter names instead of assuming. The filter helper still only
*compares* — it cannot look anyone up, which is why the resolution belongs
at the call site.

The test pins exactly this: the Ravnos is capacity 6, the acting vampire
5, the blocker 5. A blocker younger than the player and **not** younger
than the actor is the one case where the old yardstick and the new one
disagree.

## §3 — A price paid by a third minion

"The chosen vampire burns 1 blood, **or this card has no effect**" is a
cost paid by a minion that is neither the actor nor a target. The helper
is chosen as the card is played and rides in the option id, and **only
helpers who can actually pay are enumerated** — which is what keeps the
"no effect" branch from being a trap a player can walk into.

The stealth lives *inside* `otherMinionPaysBlood` rather than beside it as
a second effect in the mode. Two independent effects cannot express "or
this card has no effect": the stealth would land whether or not the blood
was paid.

## What the wave found

No engine defect. Two mistakes of mine, both worth more than a defect:

**I rebuilt a primitive that existed.** `modifyBlockerIntercept` was
already there with a better gate than the one I wrote. The typecheck
caught it only because `EFFECT_TAGS` is a total `Record` over the effect
union — an exhaustive map is what turned a silent duplicate into a
compile error.

**A test fixture that shared a card id.** `threeSeatGame` deals Alice a
Conditioning with instance id `c1`; the fixture pushed the wave's card
with the same id, so the engine resolved the wrong card and three working
cards looked like three broken ones. The log said so plainly
(`BleedAmountModified` from a card that does not modify bleeds) — the
event log is the thing to read first when an effect "does not happen".

Also relearned, at the cost of two runs: **a modifier resolves when the
impulse cycle it was played in completes**, not when its as-played window
closes. A test that reads the effect after three passes reads it too
early.

## Tests

`tests/cards/second-minion-modifiers.test.ts`, 5 tests, two of them
negative space: no gun means no Suppressing Fire, and a helper of the
wrong sect is not offered to Stealth Ritus. The unaffordable-helper case
is deliberately **not** the negative test — a minion at 0 blood has a
mandatory hunt (p. 21) and the fixture never reaches the bleed, which is
the trap CLAUDE.md records seven instances of.
