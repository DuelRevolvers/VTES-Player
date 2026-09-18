# One-shot weapons — "Burn after use"

Tranche 3, wave 23. Four legacy weapons, one sentence in common:

| Card | KRCG | Printed |
|---|---:|---|
| Grenade | 100857 | 3R damage as a strike. If used at close range, the bearer takes 1 damage. Burn after use. |
| White Phosphorus Grenade | 102179 | 2R aggravated each strike. If used at close range, the bearer takes 1 aggravated. Burn after use. |
| Smoke Grenade | 101814 | End combat as a strike, only usable at long range. Burn after use. |
| Waxen Poetica | 102162 | Unique. Strike: 2R aggravated. Not usable against a vampire with Celerity, an ally, or a retainer. Burn after use. |

**§0 (does the pool contain the targets):** Waxen Poetica is the only one
that filters, and it filters NEGATIVELY — "not usable against" can never
be inert, because the empty case is the case where the card works. The
pool has Celerity vampires and allies either way.

## §1 — "Burn after use" is a moment, not a flag

The whole family turns on *when* the weapon burns, and the rulings say it
twice, from both directions:

> "Does not burn nor inflict damage if combat ends before it resolves
> (eg. if the opponent uses a 'strike: combat ends')."
> — [LSJ 19981006], [LSJ 20001127-2], [LSJ 20010806-1]

> "Still burns when used if the opponent uses a 'strike: combat ends'
> too. It does not burn if combat ends before strike resolution."
> — [LSJ 20001127-2] (Smoke Grenade)

So the burn is not spent when the strike is CHOSEN — which is where
`usableOnce` is spent, deliberately and for the opposite reason (a dodged
strike was still a use of the weapon). It is spent when the strike
RESOLVES.

That put the code in two places, because "resolves" has two exits:

- **The ordinary path**, in a new `oneShotRiders` pass beside the ammo
  one. Both sit OUTSIDE `inflict`, which returns early on a dodge, on a
  range mismatch and on zero damage — p. 33 cancels the effects of a
  dodged strike *on the dodging minion*, and burning your own weapon
  happens on your own side of the table. This is the Dragon's Breath
  precedent, already in the engine and already documented there.
- **The combat-ends branch**, which returns before any of that. A weapon
  burns there **only if its own strike is the combat-ends strike** — the
  Smoke Grenade going off. A Grenade on the other side of the same round
  never resolved and is left alone. One loop, one condition, and both
  rulings above fall out of it.

## §2 — The bearer's damage is environmental

> "Damage done to the bearer is environmental." — [LSJ 19970801]

`source: null`, the same shape retainer output and Carrion Crows already
use. It matters: with no source, nothing that reads "damage from the
opposing minion" can see it — not `preventAllFrom`, not a dodge, not a
reaction that keys on who struck. It is pushed through
`pushPendingDamage` like everything else, so Dawn Operation's combat-wide
aggravation still reaches it without this site knowing that card exists.

The clause is a **clause, not a cost**: at long range nothing happens to
the bearer at all, which is a negative-space assertion in the tests
rather than a comment.

## §3 — A weapon that ends combat

`Strike` already had `combatEnds`, and `chooseWeaponStrike` was hard-coding
it to `false` — every weapon that had existed dealt damage. Passing it
through was the whole of Smoke Grenade, plus a label that says "combat
ends" instead of a damage figure, because an option that reads
"Smoke Grenade: strike (0R)" describes nothing a player would recognise.

`onlyAtLongRange` was already there from the Sniper Rifle and did the
range gate for free.

## §4 — "Not usable against"

A gate on the OPTION, not a fizzle at resolution. A one-shot weapon that
could be spent on a strike that does nothing would be a trap with no
rules basis — the card says it is not usable, so it is not offered. Read
off the opposing minion with `disciplinesOf`, at any level ("a vampire
with Celerity", not superior Celerity).

A retainer is not a combatant in this engine, so the clause's third case
cannot arise; it is noted at the call site rather than tested for.

## What the wave found

**`chooseWeaponStrike` could not say "combat ends"** — the field existed
on `Strike` and the weapon path pinned it to false. Nothing was broken by
that until a weapon wanted it, which is the ordinary way a gap of this
kind surfaces.

**Aggravated damage is where blood stops being evidence.** The first
draft of the tests asserted blood totals and failed on both aggravated
cards: this engine sends a ready vampire to torpor on *any* aggravated
damage, so 1 point and 2 points leave identical blood. The tests now read
`DamageInflicted` from the event log, which also makes the environmental
packet (`source: null`) directly assertable — the thing the wave actually
adds — instead of inferring it from arithmetic that two other packets
were contributing to.

## Tests

`tests/cards/one-shot-weapons.test.ts`, 7 tests. The one worth reading is
**Smoke Grenade vs Grenade in the same round**: both are chosen, the
smoke ends combat, the smoke burns and the grenade does not — the two
rulings in §1 asserted against each other in one combat rather than one
each in two fixtures that could both be passing for the wrong reason.
