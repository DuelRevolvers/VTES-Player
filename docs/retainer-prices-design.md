# Retainers bought with a price

Tranche 3, wave 26. Three retainers whose entire text is **a price and a
window**.

| Card | KRCG | Printed |
|---|---:|---|
| Corpse Minion | 100428 | Ghoul, 1 life. "Vampire with this retainer may **burn X blood** to get **+X intercept** for the current action." |
| Malajit Chandramouli | 101148 | Requires a non-Camarilla vampire. Unique mortal, 1 life. "Employer may **lock him** to get **+1 stealth** for the current action. If that action is **blocked, burn Malajit**." |
| Omael Kuman | 101320 | Unique ghoul, 1 life. "Employer can **burn 1 blood** to **set the range** for the round before range is determined, during the first round of combat." |

Wave 22 asked what a retainer does in a fight. This one asks what a
retainer *costs*, and the three answers are different: the **employer's
blood**, the **retainer's own lock**, and the employer's blood again for
something that is not a bonus at all.

## §1 — A price with no latch

`retainerAbilities` already had `lockForIntercept` (Feral Hound) —
intercept bought with the retainer's lock, which spends it for the turn.
Corpse Minion buys the same thing with the **employer's blood**, and is
never spent:

> "May be used any number of times during a single action."
> — [TOM 19960109]

So `burnBloodForIntercept` has no latch at all, and is enumerated one
point at a time. "Burn X for +X" and "burn 1 for +1, repeatedly" are the
same offer, and the second needs no X in the option id — the ruling above
is what makes them equivalent rather than an approximation.

It is offered on exactly the terms `lockForIntercept` is: only while this
minion is the one attempting the block. Intercept a blocker does not have
is worth nothing (p. 26, read from the other side), and the negative-space
test is the retainer sitting on the *acting* minion, where it must offer
nothing at all.

## §2 — A price the retainer pays twice

Malajit is the mirror — `lockForStealth` — with a second clause that is
the interesting half: *"if that action is blocked, burn Malajit."*

The burn fires at the **block-success site**, alongside `blockedToll` and
`blockedPoolToll`, which are the two existing "the actor pays for having
been blocked" statics. It reads `burnIfEmployerBlocked` **and requires the
card to be locked**: locking him is how he is spent, so a locked one is a
used one, and a retainer that never answered the action pays nothing for
it. The entries are collected before burning, because burning mutates
`attached` underneath the loop.

The stealth itself is gated the way every stealth card is — a block
attempt underway whose blocker currently has enough intercept (p. 26,
gate 1 of the three in CLAUDE.md). That gate is also what makes the burn
clause reachable: with a bare blocker, +1 stealth simply **wins**, the
action is not blocked and Malajit survives. A test that does not give the
blocker enough intercept to still succeed is a test that never exercises
the clause it claims to.

## §3 — A price for the range

Omael Kuman spends blood at `combat.beforeRange`, in round 1 only, to set
the range — `setCombatRange`, the op the Sniper Rifle's snipe already
uses. Two options, one per range, minus the one it already is: setting the
range to the range is not a choice.

Two rulings are worth recording and neither needed code:

- *"Once the range is set, no other effect can be used to reset the range
  that round"* [RTR 19970630] — the engine's `RangeSet` already skips the
  determine-range step, so this is describing what happens rather than
  asking for anything.
- *"If another effect was already setting that round's range, that effect
  has priority"* [PIB 20120214] — priority between two pre-range setters
  is a question the pool cannot currently ask, since nothing else in it
  sets the range before it is determined.

## What the wave found

No engine defect. One **test** defect, and it is the more useful of the
two to record: the first draft built the retainer entry by hand with
`statics: {}`, so Malajit's burn-when-blocked clause **did not exist in
the fixture**, and the test failed against a copy of the card that had
never had the thing being tested. The entry helper now takes its statics
from the compiled handler, the way the weapon tests already did.

That is the "empty for the wrong reason" lesson in its test-side form: a
fixture assembled by hand is a second, silently drifting model of the
card.

## Deferred

**Ghoul Escort** (100817) — "when this vampire is blocked, they may burn
this retainer and **unlock instead of entering combat**". Same family, but
it is not a price for a bonus: it replaces the block's second consequence
(p. 27), which means an optional choice raised at the block-success site
before `pushCombat`, and a path where an action is blocked with no combat
at all. Worth its own wave with the other combat-avoidance cards.
