# Ending an action early

*Change of Target (100323), Mirror Walk (101223), Obedience (101309),
Delaying Tactics (100519), Faceless Night (100687).*

## 1. The cluster

Four cards stop an action that is already underway, before it would
resolve, and three of them add the same rider — *and that minion cannot
do it again this turn*. Faceless Night joins them because it is the last
of the fail-block family (`docs/fail-block-design.md` named Fever Pitch,
Faceless Night and Mirror Walk as its leftovers) and it fires at the same
moment: **before action resolution**, on the blockers who failed.

| Card | Type | What it does |
|---|---|---|
| Change of Target | Action Modifier | blocked, before block resolution: unlock this minion, the action ends unsuccessfully, no repeat this turn |
| Mirror Walk `[THA]` | Action Modifier | as above but **locks the blocking minion**, and does not unlock the actor |
| Obedience `[dom]` | Reaction | about to enter combat with an acting *younger* vampire: unlock the actor and end the action, no repeat. `[DOM]`: do not unlock |
| Delaying Tactics | Reaction | cancel the referendum, unlock the acting vampire, return the political card, no repeat **by any of that Methuselah's minions** |
| Faceless Night `[OBF]` | Action Modifier | minions who attempt to block **and fail** become locked before action resolution |

## 2. The rulebook rules three of these, and one ruling changed the code

**Change of Target** (p. 47):

> Since the action ends before the block resolution, the blocking minion
> is **not locked for blocking**. If the blocking minion was locked and
> had used a wake effect to block, they remain locked.
>
> If the acting vampire was performing a **mandatory** action (such as
> hunting because they had no blood), they are **"stuck"**. They remain
> unlocked but cannot perform any action.

**Mirror Walk** (p. 49):

> Not replacing the card works the same way as if it was counting against
> your hand size […]
>
> **Contrary to Change of Target, Mirror Walk explicitly locks the
> blocking minion** before [the action ends].

**Faceless Night** (p. 48):

> If a minion attempts to block and fails, they can still play reaction
> cards such as a Deflection. **They become locked only once the action
> resolves** (either because it is successful, or because it is blocked).
>
> Faceless Night does **not lock retroactively** minions who previously
> attempted to block.

That last sentence is the one that changed the implementation. The obvious
build — fold the event log for `BlockFailed` on this action and lock them
all at resolution — is **wrong**: a minion that failed *before* the card
was played is not locked. So the frame records failures only from the
moment the card resolves, and the log is not consulted.

## 3. `endAction()`

```ts
endAction(args: { unlockActor?: boolean; lockBlocker?: boolean }): void
```

Three things at once, and the ordering matters:

1. **The pending block attempt is cancelled, not failed.** That
   distinction already exists (`BlockAttemptFrame.cancelled`, built for
   Dawn Operation) and it is exactly what p. 47 describes: the blocker is
   not locked *for blocking*. `failBlockAttempt` would write `cannotBlock`
   and lock them; a cancelled attempt does neither.
2. `af.step = "blocked"` — the existing unsuccessful path (`failAction`),
   so no cost is paid and no effect runs.
3. The card's own extras: `unlockActor` (Change of Target, Obedience
   basic) and `lockBlocker` (Mirror Walk, the one difference p. 49 calls
   out by name).

"If the blocking minion was locked and had used a wake effect, they remain
locked" needs no code: cancelling an attempt does not unlock anybody, and
the blocker's locked state predates the block.

## 4. "…cannot perform the same action again this turn"

New: **`MinionState.cannotRepeat`** and **`SeatState.cannotRepeat`** —
lists of *action keys*, cleared on `TurnBegan` beside the other
per-turn records.

The key is `actionKeyOf(af)`: the **card name** for an action announced by
a card, and the **`ActionKind`** otherwise (`bleed`, `hunt`, `cardEffect`
…). That is what "the same action" means: playing a different card is a
different action, and bleeding again is the same one.

Delaying Tactics is the seat-scoped version — "minions controlled by the
acting Methuselah cannot perform the same political action again this
turn" — which is why the list exists in both places.

Gates go where the options are enumerated: the built-in action list
(bleed/hunt/…) and the action/political card compilers.

### The "stuck vampire" ruling falls out of the model

A 0-blood vampire **must** hunt (p. 21), so hunting is its only legal
action. Change of Target unlocks it and bars it from hunting again this
turn — so it is unlocked with no legal action at all, exactly as p. 47
describes. Nothing implements "stuck"; it is what the two existing rules
produce together, and there is a test asserting it.

## 5. Faceless Night: locking failed blockers

`ActionFrame.lockFailedBlockers` is set when the card resolves, and from
that point every `BlockFailed` on this action appends to
`ActionFrame.failedBlockersToLock`. They are locked at **action
resolution**, whichever way it goes (p. 48: "either because it is
successful, or because it is blocked") — so the same place
`notBlockPenalties` are charged.

Not retroactive, and not read off the event log: see §2.

## 6. Mirror Walk's replacement

> "Do not replace until your next discard phase."

`delayedReplace` had `"unlock"` and `"afterAction"`; this is a third,
`"discard"`, with its own counter (`SeatState.delayedDrawsDiscard`)
flushed as the discard phase opens — before the discard-down check, so
the hand is back to normal size when it is measured. That reproduces the
p. 49 ruling's description ("a hand size of 6 until your discard phase")
without modelling hand size at all.

## 7. Rulebook citations

- p. 21 — a vampire with no blood must hunt (the "stuck" ruling's other half).
- p. 24 — one political action per vampire per turn.
- p. 25 — the acting minion locks at announcement; block attempts (state B).
- p. 27 — a blocked action does not resolve, and its cost is not paid.
- p. 37 — "you receive by default one discard phase action".
- p. 47 — the Change of Target ruling quoted in §2.
- p. 48 — the Faceless Night ruling quoted in §2.
- p. 49 — the Mirror Walk ruling quoted in §2.
