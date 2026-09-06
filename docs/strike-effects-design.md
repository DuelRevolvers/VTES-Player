# Combat Strike Effects — Design (Gate 1)

Status: **IMPLEMENTED** (2026-07-19). Roadmap gate 1. Aggravated damage
resolves per §3 (no mend → torpor; burns an already-wounded/torpor
vampire that can't pay); `strikeDamage` and `strikeStealBlood` added,
plus strike maneuver/press riders and the `onlyAfterFirstRound` combat
usability. Deviation carried: Fortitude/generic prevention still prevents
aggravated (non-aggravated typing folds in with the first-strike
follow-up). Deferred as planned: first strike, destroy/steal weapon, and
the "hand strikes aggravated this round" modifier.

Scope this gate: **fixed-damage strikes**, **aggravated damage**, and
**steal-blood strikes** — the three cleanest, most reused strike effects.
Deferred to a follow-up: first strike, destroy/steal weapon, and the
"your hand strikes are aggravated this round" modifier (Claws of the
Dead) — each is a smaller add on top of this foundation.

## 1. Rulebook facts (p. 31, p. 33–34)

- **Aggravated damage** differs from normal in two ways (p. 34):
  (a) it **cannot be mended** — the vampire burns no blood, and instead
  becomes wounded (**goes straight to torpor**) unless prevented; (b)
  aggravated damage on an **already-wounded** vampire (unmended damage, or
  in / on its way to torpor) burns 1 blood **per point to prevent
  destruction**, and if it can't, the vampire is **burned** (to the ash
  heap, not torpor — not diablerie). Normal + aggravated at once: **normal
  is handled first**.
- **Steal blood** (p. 33): moves blood/life from the target to the striker
  (not damage — cannot be prevented by damage prevention; resolves before
  the mend step). Excess over the striker's capacity drains off.
- **Fixed-damage / ranged strikes** already exist as the weapon-strike
  shape (`Strike.damage`, `ranged`).

## 2. State

```ts
// PendingDamage gains:
aggravated: boolean;

// Strike gains:
stealBlood: number;   // >0 → a steal-blood strike (no damage)
```

`HAND_STRIKE` / weapon / card strikes get `aggravated: false`,
`stealBlood: 0`.

## 3. Damage resolution (applyCombatPass "damageResolution")

Pending damage is sorted acting-first (existing) and, for a given victim,
**normal before aggravated**. Per pending damage:
- **Normal** (existing): mend `min(blood, amount)`; unmended → torpor.
- **Aggravated**: not mended. If the victim is **not** already in torpor →
  `WentToTorpor` (wounded, no blood burned). If **already** in torpor
  (wounded by earlier normal damage this pass, or pre-torpor) → burn 1
  blood per point to prevent destruction; if `blood < amount` →
  `burnMinion`, else `BloodBurned(amount)`.

Ally/retainer victims treat aggravated as normal (p. 32) — the existing
ally life-burn path is unchanged (aggravated flag ignored for allies).

**Prevention of aggravated**: kept generic this gate (Fortitude prevention
still prevents aggravated) — a documented deviation; the non-aggravated
restriction (Soak) is retrofitted with the first-strike follow-up.

## 4. Strikes

- `strikeDamage { amount, ranged, aggravated }` → a card strike doing
  fixed damage (like a weapon), in the choose-strike window.
- `strikeStealBlood { amount, ranged }` → a strike that, on resolution,
  moves `amount` blood from the victim to the striker (before mend);
  ranged, no damage.
- **Strike riders** (Aid from Bats "with 1 optional maneuver/press"): a
  strike that also grants a `maneuverCredit` / combat-press — reuses the
  rush-rider fields (`maneuverCredits` / `pressesCombat`).

`chooseCardStrike` (the EngineOps) gains `damage?`, `ranged?`,
`aggravated?`, `stealBlood?` params; a new `resolveStrikes` branch inflicts
steal-blood before the damage pass.

## 5. Wave (4 cards)

| Card | Effect |
| --- | --- |
| **Body Flare** (pro) | strike 2 / 2R aggravated |
| **Walk of Flame** (tha) | strike 1R / 2R aggravated; not usable first round |
| **Theft of Vitae** (tha) | strike ranged: steal 1 / 2 blood |
| **Aid from Bats** (ani) | strike 1R + 1 optional maneuver / press rider |

Walk of Flame's "not usable during the first round" adds an
`onlyAfterFirstRound` combat usability (reusable).

## 6. Deferred

First strike; destroy/steal weapon; "hand strikes aggravated this round"
(Claws of the Dead, Wolf Claws, Sculpt the Flesh) — the latter is a
before-range modifier flagging the round's hand strikes aggravated, a
small follow-up once this foundation lands. Aggravated prevention typing
(Fortitude can't prevent aggravated) folds in with the follow-up.

## 7. Tests

Kernel: aggravated damage sends a full-blood vampire to torpor (no
mend); aggravated on a torpor vampire burns it if it can't pay; normal
resolves before aggravated on the same victim; steal-blood moves blood
(capped at capacity) and isn't prevented by damage prevention. Cards: one
scenario per wave card; Aid from Bats' maneuver rider usable in a later
round; Walk of Flame not offered in round 1. Fuzz: add the wave.
