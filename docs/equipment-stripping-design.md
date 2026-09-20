# Stripping the gear

Wave 75 (2026-09-20). Fractured Armament (100784), Shattering Blow (101760),
Canine Horde (100290), Fast Hands (100704).

Four strikes that take an opponent's equipment away. The machinery was almost
all there — `Strike.burnEquipment` and `chooseBurnEquipmentStrike` have existed
since Heroic Might — so the wave is mostly about reaching it from a **card
mode** instead of only from a granted strike, and about the contrasts between
the four cards.

**Armor of Vitality (100089) is NOT in this wave.** "Prevent 3 damage, and if
any of the damage was from the opposing minion's melee weapon, that weapon is
destroyed" is a *prevention* card, in a different window, and it needs a fact
nothing records yet: **which weapon dealt this damage**. That belongs beside
`PendingDamage.fromGun` and `fromHandStrike`, stamped at the push chokepoint,
and it is worth a wave with the other cards that read it. Not a cut — a
different family.

---

## §1 — What each card is

| Card | Basic | Superior |
| --- | --- | --- |
| Fractured Armament | destroy equipment | …**with 1 damage** |
| Shattering Blow | destroy equipment | …**with first strike** |
| Canine Horde | 1R damage | ranged; destroy equipment with first strike |
| Fast Hands (1 blood) | **steal** weapon | …with first strike |

Fractured Armament and Shattering Blow have **identical basics** and buy
different things with their superiors — damage on one, timing on the other.
That pair is the reason both are here: a spec that copied `damage: 1` onto
Shattering Blow would pass every test either card had on its own.

Canine Horde's two modes are different **kinds** of strike rather than two
sizes of one: the basic deals damage and takes nothing, the superior takes gear
and deals nothing.

## §2 — Destroying: the choice is in the option id

The opposing minion may carry several cards, so the enumerator emits **one
option per candidate** and the chosen instance rides in the option id — the
same shape Up Yours! already used for "choose a weapon possessed by the
opposing minion". With nothing to take, **the mode is not offered at all**,
which is what makes its implicit "if there is one" true rather than producing
an option that resolves to nothing.

The gate is per **mode**, not per card. Canine Horde's superior disappears with
no gear on the table while its basic — a plain damaging strike — stays. A gate
that hid the whole card would look identical to a test that only checked the
superior was gone, so both halves are asserted.

**What the wave found: "destroy equipment" could not also deal damage.** The
resolution burned the card and then `return`ed unconditionally, so Fractured
Armament's "as above, **with 1 damage**" would have destroyed the gear and
dealt nothing. The fix is the guard its own neighbour already uses —
`attachToVictim`, four lines above, distinguishes "the attach IS the strike"
from "the attach is a RIDER on a damaging strike" with
`if (!strike.handBonus && strike.damage === null) return;`. Copying that guard
is the standing lesson about a new call beside an existing one: **the guards
around a line are part of what that line means.**

## §3 — Stealing is not destroying

"Strike: steal weapon" moves the card to the striker instead of burning it, so
it is `EquipmentMoved` rather than `PermanentBurned` — the same entry on a
different minion, keeping its counters and its lock state, because it never
left play (`blood-and-gear-design.md` §3).

Two things separate it from the destroy cards, and both are asserted:

- **It is still in play afterwards, on the striker.** `inPlay` alone would pass
  for destroying *and* for doing nothing; the bearer has to be checked.
- **It takes a WEAPON, not any equipment.** The destroy cards filter on the
  `equipment` tag, Fast Hands on `weapon`. Given a plain Leather Jacket, Fast
  Hands is not offered at all.

## §4 — The flag with no assertion

The first draft of the test passed 12 of 12 on the first run, and **never
asserted `firstStrike`** — a flag three of these four superiors print. A spec
flag that no test reads is exactly what gets dropped silently in a later edit,
and "all green first time" was the tell that something wasn't being looked at.

It is now asserted as a pair per card: the superior's strike carries the flag,
the basic's does not.

Reading it needed the fixture fact below, which is why it failed three times
before it passed — and that is the point: the assertion had teeth.

## §5 — The fixture fact, three waves running

**A card play's effects happen in `resolve`, which runs AFTER the as-played
window has gone round the table.** So anything the card does — a credit, a
frame flag, the strike itself — is not there immediately after `choose`. Waves
73, 74 and 75 have each lost a round to this in a different disguise:

- wave 73: a maneuver/press credit read as 0
- wave 74: a round flag read as false
- wave 75: `cf.strikes.acting` read as `undefined`

Every one of these test files now has the same four-line `settle` helper.
Three copies of one helper in three files is the shape that should become a
shared fixture the next time it is needed — noted here rather than done now,
because the fourth instance is the one that proves where it belongs.
