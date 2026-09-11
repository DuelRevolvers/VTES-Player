# The basic combat cards, and what a card with no requirement costs

*Dodge (100567), Fake Out (100693), Boxed In (100244), Dead-End Alley
(100504), Open Grate (101323).*

Wave 20, landed **v0.10.3**. Library **570 → 575**.

Five cards whose entire printed text is one of the three things any
minion may already do in combat — **dodge, maneuver, press** — with no
Discipline, no clan, no cost and no rider:

> "Do not replace until after combat. **Strike: dodge.**"

The effects have been in the vocabulary since the combat kernel. What
makes these a family is the clause that pays for them.

## 1. "Do not replace until after combat"

Every card played is normally replaced from the library at once (p. 14).
Three of these five are not: the card sits out of your hand until the
combat is over. **That restriction is the whole price of a combat card
that anyone can play** — the design pays for "no requirement" in tempo
instead of in blood, and the two cards here that carry a usage
restriction instead (Dead-End Alley, Open Grate) do *not* carry the
deferral. That contrast is why they belong in one wave.

`delayedReplace` already had `"unlock"`, `"afterAction"` and
`"discard"`. This adds **`"afterCombat"`**.

### It is not `afterAction`, and that is the point

A combat card is played inside an action frame, so deferring to
`afterAction` would have compiled, run, and looked right in every test
that only counts cards at the end of a turn.

It is wrong. **Combat ends before the action it happened inside
resolves** — a blocked action still has its resolution ahead of it, and
cards get played there. A card deferred to "after the action" comes back
one step too late, and anything played in that window sees a hand one
card short. The two deferrals differ by exactly one window, which is the
kind of gap that never shows up until someone counts.

So the list lives on the **combat frame** (`drawAfterCombat`), not the
action's, and is flushed at the engine's **single `CombatEnded` site**,
beside `applyAfterCombatRiders`. That site is the whole reason this needs
no cleanup: *combat ends four different ways, and a deferral flushed at
three of them is a card that never comes back.*

**No combat, no deferral.** The clause has nothing to wait for outside
combat, so a card played with no combat frame replaces normally rather
than being held forever.

## 2. Open Grate, and a press that can only cancel

`press.continueOnly` existed for Dead-End Alley's shape ("only usable to
continue combat", also Righteous Blade). Open Grate is its mirror — "only
usable to **end** combat" — and p. 32 makes it narrower than it reads: a
press does not end combat directly. Combat ends by default; what a press
does is *continue* it, and the only way a press ends combat is by
**cancelling a press that is already standing**.

So `endOnly` is not a second effect, it is a gate on one window:

| | no press standing | a press standing |
|---|---|---|
| Boxed In (plain) | continue | cancel |
| Dead-End Alley (`continueOnly`) | continue | — |
| Open Grate (`endOnly`) | — | cancel |

The three cards partition the same step between them, which is what makes
the negative space here worth asserting: each one's absence is another
one's presence at the same moment.

## 3. Tests

`tests/cards/basic-combat.test.ts`, 5 tests — the effects themselves are
pinned elsewhere, so these only cover what is new:

- the deferral is **held on the combat frame**, the hand is a card short
  while combat runs, and the card comes back when combat ends;
- Open Grate is **not** offered while no press is standing, with
  Dead-End Alley offered at that same moment as the control — so the
  absence is the restriction and not the window;
- and the reverse once a press stands: Open Grate appears exactly where
  Dead-End Alley disappears;
- Dodge lands in `combat.chooseStrike`, Boxed In in `combat.press`.

One thing the first test needed: **the shared fixture's library is
empty**, and an empty library replaces nothing — so a test about
replacement passes by the draw never happening. It seeds a card first.
That is the "empty for the wrong reason" lesson in its most literal form,
and it cost one red run to notice.

Fuzz: all five dealt in, green on the first run.

## 4. Not done

The rest of the "do not replace until after combat" cards each add a
second clause and are separate builds, not more of this wave:
**Disengage** (press to end, *or* burn 1 blood to cancel a grapple),
**Groundfighting** (maneuver or press or cancel, and requires an anarch),
**Lucky Blow** and **Quick Jab** (hand strikes with riders). They all use
`delayedReplace: "afterCombat"` as-is when they land.
