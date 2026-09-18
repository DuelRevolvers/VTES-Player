# The first-strike cards

The three cards wave 28 deferred, built on the kernel from
`docs/first-strike-design.md` (v0.10.14). Library **603 → 606**.

| Card | KRCG | Printed |
|---|---:|---|
| Quick Jab | 101529 | Do not replace until after combat. Strike: hand strike (at strength damage) **with first strike**. If more than 1 damage is inflicted with this strike, **ignore the excess**. |
| Forearm Block | 100763 | Strike: **prevent 2 damage from the opposing minion's next hand strike this round** (including any currently-resolving hand strike). If another round occurs, this minion gets **first strike** on their initial strike that round. |
| Haymaker | 100900 | Play after range is determined, close range, **not usable if this minion played a Haymaker last round**. This minion's initial strike this round **will be** hand strike at +1 damage, and the **opposing** minion's initial strike gets **first strike**. If either minion inflicts more damage than the other this round, that minion gets an optional press. |

## §1 — Quick Jab: a ceiling on a strike

`Strike.capDamage` is applied where the strike's damage is computed —
after every bonus and **before the packet exists**. That placement is the
ruling:

> "Only one damage is inflicted means only one damage needs be
> prevented." — [LSJ 20071117]

A cap applied at prevention time would leave two points on the table for
a prevention card to chew through. Capping at infliction means only one
point was ever inflicted.

The two clauses interact, which is what the first test asserts in one
breath: a strength-2 vampire jabs a 2-blood opponent for **1**, so the
opponent survives *and* strikes back. Without the cap it would be torpor
and no reply.

## §2 — Forearm Block: a strike that only prevents

The strike declares 0 damage and arms two riders instead.

**The prevention** is a round-scoped pool (`preventHandStrike[side]`)
drained in `drainAutoPrevented`, beside the automatic preventions the
engine already applies without asking — the card was played, and its
points are not optional. "Including any currently-resolving hand strike"
needs no special case: strikes resolve simultaneously, so the opposing
hand strike's damage is in the same batch.

Two rulings shaped it:

- *"If fewer points of (preventable) damage are being resolved, then the
  effect prevents all of those points"* [RTR 20041202] — so it is a pool,
  not a fixed subtraction.
- *"Unused prevention points can't be carried over unless optional
  ('can/may prevent')"* [ANK 20200318] — Forearm Block says "prevent", so
  the pool is zeroed by the first hand strike it meets, spent or not.

`PendingDamage.fromHandStrike` is read off `strike.source`, so a **melee
weapon is not a hand strike** — the card says hand strike, and Nightstick
(which says "hand or melee weapon") will need the wider test when it is
built.

**The next-round first strike** is a second field,
`firstStrikeNextRound`, promoted into `firstStrikeRound` at the round
boundary *after* that field is cleared. One field could not do it: the
clear and the grant happen at the same moment.

## §3 — Haymaker: four clauses that only make sense together

One primitive rather than four, because a card played with three of them
set is a card played wrong.

- **The forced strike.** `forcedHandStrike[side]` holds the *bonus*, and
  the strike-choice enumerator offers that side the hand strike and
  nothing else — the normal-round twin of `forcedAdditionalStrike`, and
  the same reasoning: a restriction expressed as the option list needs no
  second check at resolution.
- **First strike to the OPPONENT.** Set by the same op, because it is the
  same sentence.
- **The press to the bigger hitter**, settled as the round leaves damage
  resolution — the first moment both totals are final. `damageTaken
  ThisRound` is damage *taken*, so each side's output is the other side's
  entry.
- **"Not usable if this minion played a Haymaker last round."**
  `playedThisRound` holds names only and is cleared at the boundary, so
  it cannot answer this. `cf.playedHistory` records every combat card
  with **who** played it and in **which round**, and survives the reset.

## What this found

**`strikeHandBonus` was not forwarding its new fields.** The spec grew
`firstStrike` and `capDamage`, the engine understood both, and the
compiler's `strikeHandBonus` case passed neither through — so Quick Jab
struck for full damage, in the right order, and the test read like the
cap was broken when nothing was reading it at all.

**`pendingSecondStrike` was cleared one line too early.** The drain
nulled it *before* calling `resolveStrikes(cf, "second")`, which reads it
to know whose strike the second phase is — so the second striker's blow
silently vanished. The kernel's own tests could not see this: they all
have the second striker dying or dodging.

**The range gates were checked inside `combat.chooseStrike` only.** Any
card played in another combat window carried a range clause that did
nothing — Haymaker is "play after range is determined", so its "only
usable at close range" was inert. They now sit above the window switch.
This is the second time in two waves that a range gate turned out to be
in the wrong scope.

**A test asserting a torpor the rules do not give.** The first draft put
the victim at 1 blood and expected 1 capped damage to torpor it. A
vampire burns blood for damage and goes to torpor only when the damage
**exceeds** what it has; at 1 blood it burns the point and stays ready at
0. The fixture now starts it at 0.

## Tests

`tests/cards/first-strike-cards.test.ts`, 6 tests. The Quick Jab pair is
the interesting one: the same card, the same strength, two victims —
one that survives the cap and strikes back, one that does not and never
strikes at all. Haymaker's negative-space case is the long-range gate
that was inert until this wave.
