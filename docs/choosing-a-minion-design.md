# Choosing a minion — design (wave 87)

Three legacy action cards that each **name a minion at announcement** and then
do one thing to it. The payoffs are deliberately different — unlock, lock,
damage — because what this family is really about is the **filter**: the target
list *is* the card's rules text, and three filters in one enumerator is what
makes the negative space worth asserting.

| Card | KRCG | Cost | Text |
| --- | --- | --- | --- |
| Precognizant Mobility | 101476 | 1 blood | +1 stealth action. `[aus]` Unlock a younger vampire or an ally. `[AUS]` Unlock a vampire. |
| Distraction | 100560 | 1 blood | +1 stealth action. `[cel]` Draw 5 cards. Discard down to your hand size afterward. `[CEL]` Ⓓ Lock a minion controlled by your predator or prey. |
| Horseshoes | 100937 | — | `[pot]` Ⓓ Inflict 1 unpreventable damage on a ready minion. `[POT]` Ⓓ Inflict 2 unpreventable damage on a ready minion. |

Printed text read from `data/vtes-raw.json`, not from memory.

## 1. Why these three together

They share the whole mechanism — `targetRider` → one option per legal target →
the choice fixed at announcement (p. 25) → `af.targetMinion` at resolution — and
differ only in the predicate that builds the list. That is the shape the wave
rhythm asks for: one mechanism, several cards, and the differences are the
assertions.

The three predicates:

- **age and kind** — "a younger vampire **or an ally**", which is two
  unrelated tests joined by an `or`, and its superior replaces both with "a
  vampire" (so the ally the basic allowed is *gone* at the higher level — the
  modes are not a strict widening).
- **relation** — "controlled by your **predator or prey**", the one filter that
  reads the seating rather than the minion.
- **readiness** — "a **ready** minion", which is the loosest of the three and
  therefore the control: it offers every seat's minions, the actor's own side
  included.

## 2. The filters, in one enumerator

All three live in `enumerateActionTargets` (`compile.ts`), each returning early
with its own list, and each **excludes what the card does not name**:

- an unlock skips a minion that is **already unlocked** — nothing to unlock is a
  futile option (`docs/futile-options-design.md`);
- a lock skips one that is **already locked**, and skips every seat that is not
  the predator or the prey — including your own, and including a grand-prey's in
  a bigger game;
- damage skips anything not `isReady` — which is *not* the same as "unlocked": a
  locked minion is ready, a torpid one is not, and that distinction is what the
  card turns on.

`younger(cap, need)` and `isReady` were already there; `predatorOf` / `preyOf`
are the shared ring walk. No new helper.

## 3. Distraction's two halves have nothing in common

Its basic is a draw and its superior is a lock. The draw is
`actionDrawThenDiscard`: `drawCards` then **`discardDownToHandSize`**, never
`drawUpToHandSize` — the latter *refills* a hand, which is the opposite of what
"discard down … afterward" asks for. They are only interchangeable when the hand
is already full, so a test with a small hand would not have seen the difference
(the same trap `docs/hand-churn-design.md` records).

The lock is the mirror of Precognizant Mobility's unlock, which is why the two
cards are in one wave: the same rider, the same frame field, opposite emissions.

## 4. Horseshoes is environmental damage

"Unpreventable" is not a prevention *modifier* to honour — it is
`applyEnvironmentalDamage`, which belongs to nobody, so no prevention window
opens and no reaction reads it. Nothing else is needed for the word.

Its two modes differ only in the number, which makes it the wave's control for
the **targeting itself**: if the target plumbing were wrong, both modes would be
wrong in the same way and nothing about prevention or age could be blamed.

## 5. What the wave found: the Ⓓ is the CARD's, not the target's

Every filter test passed on the first run and **every payoff test failed** —
three assertions, three cards, all of them "nothing happened".

`targetRider` had been taught the three new kinds, so the option list was
perfect. But the params switch in `compileSpec` — the one that turns
`play.params["target"]` into `params.targetMinion` — had not, and it is a
**separate hand-written list of kinds**. Two lists answering one question, which
is the lesson this project keeps paying for. Offering a target is not the same as
the target *reaching the frame*: `af.targetMinion` was `null` on all three cards,
the applies read it, found nothing, and returned quietly. Nothing threw, nothing
logged, and a wave that only asserted its option lists would have admitted three
inert cards.

Fixing it surfaced the real rules question. `announceCardAction` derives
directedness from the target's controller (p. 25, the rush shape): name another
Methuselah's minion and the action is directed at them, so **they alone may
block**. That is right for Distraction and Horseshoes — both print Ⓓ — and
**wrong for Precognizant Mobility, which prints none**. It is a +1 stealth
*undirected* action that happens to be able to unlock somebody else's vampire,
and any seat may block it. The Ⓓ is a property of the card, not a consequence of
naming a minion.

So:

- `CardActionParams.targetNotDirecting` — the sibling of `noCombat`. Both say
  "I named this minion for a narrower reason than the rush shape assumes":
  `noCombat` means *do not fight it*, `targetNotDirecting` means *do not aim the
  action at its controller*.
- `directed: boolean` is **required** on all three primitives. Not optional with
  a default: the family is split 2–1 on the question, so either default would be
  a silently wrong answer for at least one card. A new card in this family is a
  compile error until it declares its Ⓓ — the `referendumPolarity` treatment.

The test pins it as a pair on the *same* named minion: Precognizant Mobility
naming Bob's elder is `directed: false`, `target: null`; Horseshoes naming the
same minion is `directed: true`, `target: "Bob"`. Either card alone would look
plausible with the wrong answer.

A mutation check confirmed the flag is load-bearing: dropping it makes exactly
the undirected assertion fail, and nothing else.

## 6. Tests

`tests/cards/choosing-a-minion.test.ts` — 13 cases. Each filter test carries a
**positive and a negative in the same case**, so an empty option list cannot pass
it: the age filter offers the younger vampire, the ally and the small vampire and
refuses the elder; the superior offers the elder it refused and drops the ally;
the relation filter offers the prey's and the predator's and refuses the actor's
own ally; the damage filter offers all four and refuses one put into torpor.

Fuzz: all three added to the decks. The fuzz is what walks the gap between the
choice and the resolution — the named minion can be burned, torpored or stolen in
between — and it exercises one undirected card beside two directed ones on an
otherwise identical option shape.

## 7. Counts

Library 817 / crypt 217 / total 1034; supported 916 / 1034.
