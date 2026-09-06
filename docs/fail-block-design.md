# "That block attempt fails" — the acting minion breaking a block

Status: **design + implementation** (2026-08-29). Second wave of the
action-modifier sweep, after `docs/modifier-or-combat-design.md`.

## 1. The cluster

Nine of the 37 remaining action modifiers share one clause: **"that block
attempt fails and the blocking minion cannot attempt to block this action
again"**, usually paired with a softer inferior mode, "the blocking
minion gets −1 intercept". Five are now in:

| id | card | inferior | superior |
|---|---|---|---|
| 100617 | Elder Impersonation | +1 stealth | attempt fails |
| 102337 | Relentlessness | +1 stealth | attempt fails |
| 102250 | Forced Confessional | blocker −1 intercept | attempt fails |
| 102282 | Stygian Shroud | blocker −1 intercept | burn 1 blood: attempt fails |
| 102316 | Dominant Personality | blocker −1 intercept | name a vampire that cannot block |

Still out: Hedonism (fails a block *and queues a combat between two other
minions*), Fever Pitch (attaches, and the fail comes later from the card
in play), Faceless Night (failed blockers become locked), Mirror Walk
(lock the blocker and end the action).

## 2. What was already there

The mechanic itself was built for **Enchanting Gaze**, which buys it with
a corruption counter: `BlockAttemptFrame.forceFail` makes
`resolveBlockAttempt` fail the block without locking the blocker, and
pushes it onto `af.blockRestrictions.cannotBlock` so the same minion
cannot try again — while the same Methuselah's *other* minions still can
(p. 25). All five cards here want exactly that with no corruption
attached, so the work was to expose it plainly.

## 3. Three small additions

- **`failBlockAttempt`** effect primitive → the new `ops.failBlockAttempt()`.
  Its `bloodCost` covers "burn 1 blood to have that attempt fail"
  (Stygian Shroud), charged on top of the card's own cost and gated in
  `effectsLegal` so the option is hidden when the vampire cannot pay.
- **`modifyBlockerIntercept`** — "the blocking minion gets −1 intercept",
  played by the **acting** minion. This is the mirror of `modifyIntercept`,
  which the compiler restricts to the blocker playing for itself. Its
  legality is the mirror of p. 26's "only when needed": offered only
  while the blocker's intercept still reaches the action's stealth, i.e.
  while the block would otherwise succeed.
- **`onlyAsAnnounced`** usability rule. Modifiers are only ever offered in
  the action's *effect* windows, never during the announce cycle, so
  "only usable as the action is announced" is read as **state A with no
  block attempt underway** — the same gate `unlockMinion` already uses.
  Recorded as an approximation, not an exact model of the window.

## 4. A fourth leave-play crash

The fuzz caught one more of the recurring family: the `lockGrant` stealth
branch read the **acting** minion with `getMinion`, and an actor burned
mid-action (now possible in more ways than before) made it throw. Both
that branch and the intercept branch beside it now use `findMinion` and
bail. Same lesson as the three before it, now stated in CLAUDE.md.

## 5. Count

Library cards supported: **208 → 213 of 444 (48.0%)**. Crypt 0/217
(phase 7). Total 213/661.
