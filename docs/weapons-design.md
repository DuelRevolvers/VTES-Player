# Equipment & Weapons — Design (Gate 2)

Status: **IMPLEMENTED** (2026-07-19). Roadmap gate 2.

Generalizes the bespoke `.44 Magnum` handler into a data-driven **weapon**
shape so guns and melee weapons drop in as specs. Scope: pure weapon
strikes (fixed or strength-based, optionally aggravated, optional
per-combat maneuver). Deferred: weapon additional-strike riders (AK-47),
range-setting block riders (Sniper Rifle), strike-cancel/unlock riders
(Sword of the Archangel), vehicles with bleed/stealth statics, and
non-weapon static/bespoke equipment (Kevlar Vest, Living Manse, Bowl of
Convergence, etc.) — each is its own follow-up or one-off.

## 1. Rulebook facts

- A weapon is equipment providing a **strike** (p. 33). Guns do fixed "R"
  (ranged) damage; melee weapons do **strength-based** damage
  ("strength+N"), close range. Some do **aggravated** damage.
- "1 optional maneuver each combat" (guns): using it commits that weapon's
  strike for the round (the `.44` ruling, p. 47) — already modeled.

## 2. Spec

```ts
// CardSpec (equipment):
weapon?: {
  damage: number | null;      // fixed N (gun) or null = strength-based (melee)
  handBonus?: number;         // strength + N for melee
  ranged: boolean;
  aggravated: boolean;
  maneuverPerCombat?: boolean; // "1 optional maneuver each combat"
};
```

`compileEquipment` gains a `weapon` branch producing the same
`abilityOptions`/`useAbility` shape the `.44 Magnum` bespoke handler uses:
a strike option in `combat.chooseStrike` (committed if a weapon maneuver
was used) and, when `maneuverPerCombat`, a maneuver option in
`combat.range`. Strength-based strikes set `damage: null, handBonus: N`
so `resolveStrikes` computes `strength + N` (close range); the aggravated
flag flows through the strike from gate 1.

`chooseWeaponStrike` (EngineOps) gains `handBonus`/`aggravated` params.

## 3. Wave (5 weapons)

| Card | Weapon |
| --- | --- |
| **Assault Rifle** (5 pool) | gun: 4R, 1 optional maneuver each combat |
| **Flamethrower** (4 pool) | gun: 2R aggravated |
| **Ivory Bow** (1 pool) | ranged: 1R aggravated |
| **Femur of Toomler** (2 pool) | melee: strength+1 aggravated |
| **Kali's Fang** (2 pool) | melee: strength+1 aggravated |

## 4. Tests

Kernel/cards: a gun strikes for its fixed R damage at long range; a melee
weapon strikes for strength+1 (close only); aggravated weapon damage
sends a full-blood blocker to torpor; the maneuver commits the gun's
strike (reuses the `.44` path). Fuzz: add the wave.
