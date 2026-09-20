# Bigger strikes

Wave 77 (2026-09-20). Undead Strength (102061), Pushing the Limit (101524),
Brute Force (100264), Cauldron of Blood (100309).

Four cards that all say "swing harder". Three offer the bonus on a hand strike
**or** a melee weapon strike; the fourth offers it on the hand only, which is
what isolates the weapon clause. The wave looked like the cheapest one yet —
`strikeHandBonus` and `orMeleeWeapon` both existed — and it found the most
consequential defect so far, in a card that had been in the pool for waves.

---

## §1 — What each card is

| Card | Basic | Superior |
| --- | --- | --- |
| Undead Strength | hand or melee, +1 | +2 |
| Pushing the Limit (1 blood) | hand or melee, +2 | +3 |
| Brute Force | hand **+1** or melee **+2** | hand +2 or melee +3 |
| Cauldron of Blood (1 blood) | hand +2, **not round 1** | hand +4 |

Undead Strength and Pushing the Limit are the same card one point apart, which
is the point of having both: either spec alone would look right, and the pair
is what makes a wrong `bonus` visible.

Cauldron of Blood has **no weapon clause**, so an `orMeleeWeapon` that leaked
onto the family would show up as a second option on it. Its round gate is the
one hoisted in wave 73, and it needed nothing new.

"Do not replace until after combat" (Brute Force) is `delayedReplace:
"afterCombat"`, which `resolveCardPlay`'s chain already had a branch for — a
deferral that existed and was simply unused by any admitted card.

## §2 — The asymmetric bonus

Brute Force is the only card in the family whose weapon variant is worth more
than its hand variant: **+1 by hand, +2 by weapon**. `orMeleeWeapon` was a
boolean and the mode carried one `bonus`, so both variants shared a number.

`weaponBonus` is a separate field rather than a value on `orMeleeWeapon`,
because the boolean answers *whether the option exists* and the number answers
*what it is worth*, and those are independent questions — a card can print the
option without changing its value, and three of the four here do.

## §3 — What the wave found: the weapon's own strike was thrown away

"Or use a melee weapon strike at +N damage" built the strike like this:

```ts
cf.strikes[side] = {
  source: "weapon",
  name: entry.card.name,
  handBonus: strike.handBonus ?? 0,   // the CARD's bonus, alone
  damage: null,                       // hard-coded
  ranged: false,                      // hard-coded
  …
```

Every melee weapon in the pool is `{ damage: null, handBonus: N }` — strength
plus its own bonus. So this discarded the weapon entirely and put a bare
strength-plus-card-bonus strike in its place. **Anticipation with a Righteous
Blade (+1) dealt one point less than it prints**, and had a passing test
asserting the wrong total.

The engine could not have done better: the weapon's strike shape lived only
inside the weapon compiler's closure, and the only thing exposed on the handler
was `weaponProfile`, a *measure* for the AI and Up Yours! rather than a strike.
There is now a `weaponStrike` beside it — `{ damage, handBonus, ranged,
aggravated }` — and the card path builds the weapon's own strike and adds the
card's bonus to it.

Two details that fell out of doing it properly:

- **A fixed-damage weapon ignores `handBonus` at resolution**, so a card bonus
  on a gun has to fold into the number instead. Both branches are written
  explicitly rather than hoping one covers the other.
- **`ranged` comes from the weapon now.** It was hard-coded `false`, which was
  invisible while only melee cards used this path — and wave 76's Projectile
  ("or use a **ranged** weapon strike") had just started using it. That card's
  weapon variant would have been a close-range strike.

This is the third wave running to find the same shape: **a value welded into
the site that first needed it, invisible until a second caller arrives.**
`spec.weapon` inside `compileEquipment`, the round gates inside one window, the
self-damage rider gated on `weaponCard`, and now the weapon's strike inside the
weapon compiler.

## §4 — A ruling the existing design already honoured

> "The 'make a melee strike' option can be used with Bundi while **Immortal
> Grapple** is in effect." [LSJ 20090114]

Immortal Grapple sets `handStrikesOnly`, and the gate reads:

```ts
if (cf.handStrikesOnly && !mode.effects.some(e => e.kind === "strikeHandBonus")) continue;
```

It is per **MODE**, not per option — so a mode that sets a hand strike survives,
and the weapon variant of that same mode survives with it. That is exactly what
the ruling requires, and it was already true. Asserted anyway, because the
ruling is the only thing that says so and the gate reads as though it would
forbid it.

## §5 — The fixture that proved it

The first version of this test attached an **invented** weapon — a made-up name
with the right tags. It has no entry in the registry, so its strike is worth
nothing, and "the weapon variant is bigger" quietly became "the weapon variant
is the same". Three assertions failed and pointed straight at the defect.

The fix is a **real** card: Meat Cleaver, `damage: null, handBonus: 1`. A
fixture that invents a card invents its rules too — the same lesson as the
duplicate instance id in wave 71, one level up: **what the fixture puts on the
table has to be a thing the registry knows.**
