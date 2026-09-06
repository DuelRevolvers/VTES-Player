# Dodge & Additional Strikes — Combat Mini-Gate Design

Status: **IMPLEMENTED** (2026-07-19; owner sign-off: grant additional
strikes during the chooseStrike window; full 8-card wave; Wind Dance's
extra strike free-choice, deviation noted). Implementation notes: the
combat state machine gained a `strikeRound: "normal" | "additional"` tag;
`chooseStrike`/`resolveStrikes` operate on the participant set (both in
the normal pair, only minions with `additionalStrikes[side] > 0` in an
additional sub-round); after the normal pair's damage resolves, remaining
additional strikes run extra sub-rounds at the same range before the
press step; retainer output stays once-per-round (normal only). Dodge is
a `Strike.dodge` flag handled in `inflict` (a dodge deals nothing and a
dodging minion takes nothing from the opposing strike; retainer/
environmental damage and combat-ends are unaffected).

The largest remaining card-count combat gate. Two entangled mechanics —
**dodge** (a defensive strike) and **additional strikes** (extra strike
sub-rounds) — that together unlock a clean wave of **8 Celerity/Thaumaturgy/
Oblivion combat cards**. They must land together: most dodge cards' superior
modes also grant an additional strike (Side Strike, Wind Dance, Arms of
Ahriman), so neither mechanic alone finishes a full card.

---

## 1. Rulebook facts (citations verified against the V5 PDF)

**Dodge** (Strike Effects, p. 33):
- A dodge strike deals **no damage** but protects the dodging minion and
  their possessions **from the effects of the opposing strike**.
- **Retainers are not protected.** Dodge is effective **at any range**. It
  protects even against first strike.
- **Combat ends is not affected by a dodge** — "dodge only cancels effects
  directed at the dodging minion." A dodge is still a strike (it occupies
  the minion's strike for the pair).
- Environmental / retainer damage (Murder of Crows, etc.) is **not** dodged
  — "dodging only protects from the opponent's strike" (p. 31).

**Additional strikes** (p. 32):
- Some cards let a minion make additional strikes this round, **performed
  after the first pair of strikes is completed**.
- The acting minion decides before the opposing minion (usual order).
- Handled by "another choose-strike step and resolve-strike step in which
  **only the minions with additional strikes** may play strike cards." All
  additional strikes are at the **same range**. Repeated as necessary.
- **A minion cannot use more than one card or effect to gain additional
  strikes per round** — the "(limited)" reminder. (Some cards explicitly do
  *not* count against this limit — Quickness superior.)

## 2. State model

```ts
// Strike (state.ts) gains:
dodge: boolean;   // a dodge strike — no damage, cancels the opposing
                  //   strike's effects on this minion

// CombatFrame gains:
additionalStrikes: { acting: number; opposing: number };   // pending, this round
usedLimitedAddl:   { acting: boolean; opposing: boolean };  // the one-source limit
```

`HAND_STRIKE` gets `dodge: false`; a new `DODGE_STRIKE` constant (or the
strike-setting op) sets `dodge: true`, `damage: null`, `handBonus: 0`. Both
new combat-frame fields reset at round transition (like `presses`,
`usedThisRound`).

## 3. Combat state-machine changes

### 3.1 Dodge in `resolveStrikes`

Combat-ends already resolves first (unchanged — dodge does not stop it).
For the normal damage pass, a strike that is a dodge inflicts nothing, and
a minion whose own strike is a dodge takes nothing **from the opponent's
strike** (retainer/environmental damage still applies — it runs in a
separate pass that is left untouched):

```ts
const inflict = (from, strike) => {
  if (strike.dodge) return;                         // a dodge deals no damage
  const victimDodges = cf.strikes[otherSide(from)]?.dodge;
  if (victimDodges) return;                         // protected from the strike
  ... // existing damage math
};
```

### 3.2 Additional-strike sub-rounds

**Granting** (simplification, §7 Q1): additional-strike cards are played in
the existing `combat.chooseStrike` window and increment
`additionalStrikes[side]` (setting `usedLimitedAddl[side]` unless the card is
the non-limited kind). The rulebook grants them in a window *after* the
first pair; playing them during the strike step yields the same effect
because a first pair that ends combat (someone drops) already skips
additional strikes via the existing "no longer ready → combat ends" check
(p. 30). The card does **not** set the minion's normal strike, so the minion
still chooses `strike:hand` / a strike card afterward.

**Performing**: after the normal pair's `damageResolution` empties and both
combatants are still ready, if `additionalStrikes[acting] > 0` or
`[opposing] > 0`, enter an **additional-strike sub-round** instead of going
to press:
- The set of "strikers" is the sides with `additionalStrikes[side] > 0`.
- Reuse `chooseStrike` gated to strikers only (acting first, if a striker,
  then opposing); each striker's choice **decrements** its counter.
- `resolveStrikes` inflicts only from the strikers (a side that is not
  striking contributes no strike, and cannot be the *victim-dodges* source).
- After that damage pass, loop: if any `additionalStrikes` remain and both
  ready, another sub-round; else → press.

Implementation approach: a `CombatFrame.strikeRound: "normal" | "additional"`
tag (or infer from the counters) selects which sides `chooseStrike` and
`resolveStrikes` consider. This is the one non-trivial refactor —
`resolveStrikes` and the `chooseStrike` decision/settle learn to operate on
a subset of combatants. All existing single-pair behavior is the
`strikeRound === "normal"` path, unchanged.

## 4. Spec vocabulary

```ts
// EffectPrimitive:
| { kind: "strikeDodge" }
| { kind: "additionalStrike"; count: number; limited: boolean }
```

- `strikeDodge` → `combat.chooseStrike`; sets a dodge strike.
- `additionalStrike` → `combat.chooseStrike`; grants `count` additional
  strikes. `limited: true` consumes the one-source-per-round allowance and
  is unavailable once used; `limited: false` (Quickness superior) never
  blocks and never blocks others.

`combatWindowFor` maps both to `combat.chooseStrike`. The compiler already
supports multi-effect modes, so "dodge, with 1 additional strike"
(Side Strike sup) = `[strikeDodge, additionalStrike{1,true}]`.

`combatLimit` (from the last sweep) covers the per-round/per-combat card
limits on Quickness/Form of Mist etc.

## 5. The wave (8 cards — all Discipline-gated, no sect/clan)

| Card | Modes |
| --- | --- |
| **Blur** (cel) | additional strike (1) / 2 additional strikes |
| **Lightning Reflexes** (cel) | additional strike (1) / burn X for X additional strikes |
| **Pursuit** (cel) | maneuver / additional strike |
| **Quickness** (cel) | additional strike (limited) / additional strike (not counting the limit); one Quickness/round |
| **Side Strike** (cel) | dodge / additional strike |
| **Wind Dance** (tha) | dodge / dodge + additional strike |
| **Shadow Shift** (obl) | additional strike / maneuver |
| **Arms of Ahriman** (obl) | additional strike / dodge + additional strike |

Lightning Reflexes superior enumerates the X (burn X blood → X additional
strikes), like Hidden Strength's per-blood-X. Wind Dance superior's
additional strike is nominally "a dodge"; modeled as a free-choice
additional strike (the minion will normally dodge) — a minor deviation,
flagged.

## 6. Deferred (out of this gate)

- **Form of Mist** (pro) — superior's "after combat ends, burn 1 blood to
  continue the blocked action as unblocked" is a bespoke continue-action
  rider. Its basic (dodge) alone can't ship without the superior.
- **Voracious Vermin** (ani) — superior's "additional ranged strike: burn
  weapon" needs destroy/steal-weapon strikes (unmodeled).
- **Swift Cover** (cel/obf) — superior "+1 stealth" on a combat card is an
  odd dual-use timing; deferred.
- **Dust Up**, **Diversion** (Anarch) — sect-gated.
- **AK-47** — weapon (gun) with a weapon-only additional strike; belongs
  with a weapons pass.
- **Treasured Samadji** — a clan (Ravnos) permanent, not a combat card.
- **Steal-blood / burn-weapon / first-strike / aim** strike effects —
  separate future gates.

## 7. Open questions for the owner

1. **Additional-strike granting timing** — model it as played during the
   `combat.chooseStrike` window (recommended: identical effect, far simpler
   state machine), or faithfully add a post-first-pair declare window?
2. **Wave** — the 8 above, or trim to the pure ones first
   (Blur, Side Strike, Shadow Shift, Arms of Ahriman) and add the
   maneuver/X-strike ones after?
3. **Wind Dance** deviation (additional strike modeled as free-choice rather
   than forced dodge) — acceptable, or force the additional strike to a
   dodge?

## 8. Tests (once approved)

Kernel (tests/engine/): a dodge negates the opponent's hand strike but the
dodger still takes retainer damage; a dodge does not stop a combat-ends
strike; an additional strike runs a second choose/resolve after the pair;
the one-limited-source rule blocks a second granting card but not a
non-limited one; asymmetric counts (2 vs 1) run the right number of
sub-rounds; a first pair that drops a combatant skips additional strikes.
Cards (tests/cards/): one scenario per wave card, negative space asserted
(no second Quickness this round; Lightning Reflexes X enumeration). Fuzz:
add the wave; existing invariants hold (additional strikes bounded by the
granted counts, so combat still terminates).
