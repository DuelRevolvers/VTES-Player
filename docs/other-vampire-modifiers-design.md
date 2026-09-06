# Modifiers played by a vampire other than the acting minion

Status: **design + implementation** (2026-08-30). Queue item 1 — the
structural gate left open by `docs/actor-riders-design.md` §8 and
`docs/fail-block-design.md`.

## 1. The gate

`compileSpec`'s option loop hands an action modifier exactly one candidate:

```ts
if (spec.cardType === "actionModifier") {
  if (ctx.seat !== af.actingSeat) return [];
  candidates = [getMinion(ctx.state, af.acting)];   // ← the gate
}
```

That is the general rule and it is right (p. 24: "Only the acting minion
can play action modifiers"). But p. 12 carves out an exception the compiler
could not express:

> Some action modifier cards are played by minions "**other than the acting
> minion**". Only minions controlled by the **same Methuselah** can play
> those cards.

Note the second sentence: this is *not* a reaction. The card is still the
acting Methuselah's, played from their hand, by one of their **other**
vampires. `ctx.seat !== af.actingSeat` stays.

## 2. The cards

| id | card | who may play it | the rest |
|---|---|---|---|
| 100362 | Cloak the Gathering | **superior only**: a ready vampire | inferior is an ordinary modifier |
| 102097 | Veil the Legions | a ready **unlocked** vampire | one per action; superior banks stealth |
| 102328 | Hedonism | a ready **unlocked** vampire, and only while a block is being attempted | fails the block, then queues a combat |
| 102325 | Gifts From Hereafter | a ready unlocked vampire | **DEFERRED** — see §7 |

Two different tests, so two rules: **`byOtherVampire`** ("a ready vampire",
Cloak — locked is fine) and **`byOtherUnlockedVampire`** ("a ready unlocked
vampire", Veil and Hedonism). Ready-but-locked is a real distinction, not
pedantry: Cloak can be played by a vampire who has already acted this turn,
and the other two cannot.

## 3. Candidate sets are per-card, gated per-mode

Cloak the Gathering is the awkward one, and the reason the rules are
per-mode rather than per-card:

> `[obf]` +1 stealth.
> `[OBF]` **Only usable by a ready vampire other than the acting minion.**
> The acting minion gets +1 stealth.

The inferior mode is an ordinary modifier played by the acting minion; the
superior is the new shape. So one card must offer both, from different
minions, in the same window.

This is exactly the problem `byLockedMinion` already solved for reactions
(Eyes of Argus mixes an unlocked-blocker mode and a locked-vampire wake
mode): **widen the candidate list if any mode wants it, then gate per
mode**. So:

- candidates = the acting minion, **plus** the acting seat's other
  vampires (filtered ready, or ready+unlocked) whenever any mode or the
  card carries one of the two rules;
- a mode carrying such a rule is offered **only** to a non-acting vampire;
- a mode carrying neither is offered **only** to the acting minion.

Nothing else changes. The option id already carries the playing minion
(`play:<Name>:<mode>:<minion>:…:<cardId>`), so two candidate vampires
produce two distinct options with no new plumbing, and a trace test picks
whichever it means.

**Allies are excluded throughout.** All four cards say "vampire".

## 4. Hedonism: a combat between two minions that are not the actor

Hedonism's fail-block half is free — `failBlockAttempt` has existed since
`docs/fail-block-design.md`, and "cannot attempt to block this action
again" is exactly what `forceFail` writes. What is new is the tail:

> Lock this vampire and the blocking minion, and **queue a combat between
> them**.

Two firsts. The combat is between the *playing* vampire and the blocker —
**neither is the acting minion** — and it is *queued*, not entered: the
action it was played into is still running and must finish first.

`pushCombat(acting, actingSeat, opposing, opposingSeat, riders, fromBlock)`
is already fully general about who fights, so the pairing needs no work.
The queueing does, and the precedent is sitting next to it:
`ActionFrame.afterResolutionDamage` (Daring the Dawn) is the same idea, and
a successful political action already pushes its referendum frame **after**
`this.pop()`. So `ActionFrame.queuedCombats` flushes in that same place,
after the action frame is off the stack.

Guarded at flush time rather than at play time: either minion can be burned
or sent to torpor between the play and the flush, so a queued combat whose
participants are no longer both ready simply does not happen.

## 5. Veil the Legions: a stealth bank

> `[OBF]` … this vampire can **burn X blood to give the next X actions
> minions you control perform this turn +1 stealth**.

Three separate things, none of which existed:

- **A variable cost.** X is chosen when the card is played, so the compiler
  emits one option per affordable X (`x=1`, `x=2`, …), which lands in the
  option id. This is the shape `paymentSplits` already uses for cost
  sources — the choice is made at announcement and shows in the id.
- **A charge bank.** `SeatState.stealthCharges` — a count, spent one per
  action the seat announces, applied as a `StealthModified` event at
  announcement so `currentStealth` needs no special case. Cleared on
  `TurnBegan`, which is what "this turn" means.
- **Two named limits.** "Only one Veil the Legions can be played each
  action" is per-action across *all* minions (`oncePerAction`), which is
  stricter than the existing per-minion p. 10 limit; "only one at superior
  each turn" is per-seat, per-turn, per-mode (`oncePerTurnAtSuperior`).

The bank deliberately does **not** try to be "the next X actions" as a
queue of specific actions — it is a counter, and a counter spent one per
action is the same thing while being state that can be serialised and
replayed.

## 6. What did NOT need building

Worth recording, because it was the expected cost of this gate:
`modifyStealth` is **action-scoped**, not minion-scoped —
`currentStealth(state, actionId)` folds `StealthModified` events for the
action. So "the acting minion gets +1 stealth", played by somebody else,
is the *same effect primitive* the acting minion's own stealth cards use.
No effect needed re-targeting; only the question of who may play it moved.

## 7. Deferred: Gifts From Hereafter (102325)

> Only usable by a ready unlocked vampire other than the acting **wraith or
> zombie ally**.

Its entire text is conditioned on the acting minion being a wraith or
zombie ally, and **wraith/zombie allies are on the BLOCKED list** in
CLAUDE.md pending owner review. Every clause would enumerate nothing.

The Wall Street Night precedent (a clause written against a tag that
matches no card in the V5 pool) does not apply: that card had a *second*
clause that works, so supporting it was honest. This card has none, so
marking it supported would claim a card that can never do anything. It
stays unsupported until the wraith/zombie decision is made.
