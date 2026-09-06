# Healing another minion — and a correction

Status: **design + implementation** (2026-08-30). Queue item 1, opened by
the outside-the-combat gate's deferral of Touch of Valeren.

## 1. The premise was wrong, and that is the main finding

The queue entry said Touch of Valeren was blocked because "minion-targeted
action cards played from hand" needed plumbing the engine only had for
granted and rush actions.

**That was incorrect.** `compileActionCard` has had a general
target-rider mechanism the whole time: `targetRider(mode)` spots a
targeting effect, `enumerateActionTargets` lists the legal targets, and the
option loop emits **one option per target** with the choice in the option
id — fixed at announcement, as p. 25 requires. `actionAddBloodToVampire`
(Fifth Tradition: Hospitality) already used it.

So the gate did not exist. What was actually missing was much smaller, and
is listed below. The lesson is worth recording: **a deferral written while
finishing another card is a hypothesis, not a finding.** This one cost a
queue slot and would have cost a wasted design pass if it had not been
checked before building.

## 2. What was genuinely missing

### 2.1 Three flags on an existing primitive

`actionAddBloodToVampire` targeted "another **vampire**". Touch of Valeren
says "a **minion**", which includes allies and the actor:

- `allies` — widen past vampires;
- `self` — the actor may heal itself;
- `capped` — "not to exceed their starting life".

`capped` is the interesting one, and it needed **no new state**: an ally's
`capacity` field already stores its printed starting life (the
`AllyEnteredPlay` applier says so — "a reference, not a cap"), so
`capacityOf` is the ceiling for both kinds of minion. The `BloodGained`
clamp already handles vampires; the trim here is what stops an ally going
over.

A target already at its starting life is **not enumerated** — an option
that would do nothing is not a legal option worth offering.

### 2.2 `actionOrCombat`

Touch of Valeren is Action/Combat. `compileModifierOrCombat` had already
solved this shape — split the modes by whether `combatWindowFor` gives them
a window, hand each half to the compiler that owns its law, and dispatch
`resolve` by mode. `compileActionOrCombat` is that function with
`compileActionCard` in place of the modifier compiler.

### 2.3 An action-cost modifier from a card in play

> Rescuing a non-Tremere vampire from torpor costs this Salubri **-2
> blood**, and if the action is successful, the rescued vampire gains 1
> blood. — Saulot's Healing Touch

The rescue cost is 2 blood, split between actor and victim and **fixed at
announcement** (p. 23), so the discount is not a simple "cost -2": it
reduces *this Salubri's share*.

`PermanentStatics.rescueDiscount { amount, notClan, bonusBlood }` is read
by `rescueDiscountFor(actor, victim)` in derived.ts at **two** sites, and
both matter:

- **Enumeration**, so a Salubri with 0 blood is still offered the
  "actor pays 2" split — without this the discount would be unreachable in
  exactly the case it exists for;
- **Payment**, where `max(0, fromActor - discount)` is what actually burns.

The `notClan` exclusion is the card's "non-Tremere", and `bonusBlood` is
its second clause, emitted after `LeftTorpor` so the rescued vampire is out
of torpor when it gains.

### 2.4 A granted action that heals

"This Salubri can add 1 blood or life to another ready minion … as a +1
stealth action" is the granted-actions gate with a target and **no
combat** — the Cave of Apples shape (a granted action that targets a
minion without entering combat). It is undirected: it helps rather than
attacks, and takes no `targetMinion`, so nothing is pushed.

## 3. Cards

| id | card | what it needed |
|---|---|---|
| 102262 | Touch of Valeren | §2.1 + §2.2; its combat modes came free from the outside-combat gate |
| 102259 | Saulot's Healing Touch | §2.3 + §2.4 |
