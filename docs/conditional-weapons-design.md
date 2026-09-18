# Conditional weapons

Tranche 3, wave 39. Library **633 → 636**. Three weapons whose whole text
is a condition on **when** they may be used — the Equipment bucket's first
wave since the one-shot weapons of 23.

| Card | KRCG | Printed |
|---|---:|---|
| Deer Rifle | 100516 | Weapon: gun. 1R damage each strike, with **two** optional maneuvers each combat. |
| Blade of Bellona | 100175 | Melee weapon. Strike: strength+1 damage, with 1 optional maneuver each combat, **only usable to get to close range**. |
| RPG Launcher | 101656 | Weapon. 6R damage each strike; **only usable after the first round** of combat; only usable at long range. |

Damage, range and the once-per-combat latch were all already there
(`docs/weapons-design.md`, `docs/weapon-riders-design.md`). What was not
is any weapon whose *maneuver* is more than one, or restricted in
direction, or whose strike is barred for a whole round.

## §1 — Two maneuvers, and the slot that only holds one

`CombatFrame.usedWeaponManeuver` is one slot **per side**, holding the
card that maneuvered: it enforces "one weapon per side per combat" and it
is what the `.44` ruling's committed-strike rule reads. A weapon printed
with two maneuvers cannot live in it.

So the count moved beside it rather than replacing it:
`weaponManeuversUsed`, keyed by **card instance** for the Chainsaw reason
(*"a second copy allows a second use in the same combat"* [ANK 20230316] —
two copies are two weapons). The side slot still bars a *different*
weapon; the per-card count bars the same one going past its limit. Both
gates are read at the option, and `useWeaponManeuver` no longer throws
when the same card comes back.

*"Only usable to get to close range"* needs no new state at all: a
maneuver flips the range, so only a **long** round can reach close. The
gate is `cf.range !== "long"`, and it sits beside the maneuver's other
conditions rather than inside the resolution — a maneuver that is offered
and then does nothing is the futile-option shape
(`docs/futile-options-design.md`).

## §2 — A strike barred for a round

*"Only usable after the first round of combat"* is the sibling of
`onlyAtLongRange`, one line away from it, and both are gates on the STRIKE
OPTION rather than on the strike's resolution. Rounds are 1-based, so
"after the first" is `cf.round > 1`.

This is the first weapon in the pool that offers **nothing** in a round it
is present for, which is worth a fuzz deck entry on its own: an option
list that must shrink and then grow back as the combat runs is exactly the
shape a latch that never clears breaks.

## What the wave found

**Nothing broken.** The three conditions each landed one line from an
existing one, which is what a mature primitive vocabulary is supposed to
feel like — the second wave in a row where the cards asked for extensions
rather than repairs.

The one judgement call is recorded above: the two-maneuver weapon could
have been done by widening `usedWeaponManeuver` into a count map, which
would have been fewer fields and would have quietly changed what
`committedStrike` reads. Adding a parallel count keyed by card is more
state but keeps the existing rule saying exactly what it said before.

## What is left

111 equipment cards. The short-text ones remaining cluster into another
two or three waves: clan- and discipline-granting equipment (Drum of Xipe
Totec, Hand of Conrad, Amulet of Temporal Perception), equipment that
burns itself for a benefit (Blood Tears of Kephran), and the ones gated on
clans not in the pool. **Writ of Acceptance is out of scope** — "is
considered a Camarilla vampire" is a sect change.

## Tests

`tests/cards/conditional-weapons.test.ts`, 3 tests, two of them negative:
Blade of Bellona's maneuver disappears at close range, and the RPG
Launcher offers no strike in round 1 and does in round 2. The fixture
pushes a combat frame directly, because every question in this wave is
about the frame's own state (round, range) and scripting a combat to reach
round 2 at long range costs more than it proves.
