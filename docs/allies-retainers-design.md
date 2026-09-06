# Allies & Retainers — Design (Phase 3 gate)

Status: **IMPLEMENTED** (2026-07-19, owner-approved). Owner decisions on
record: life reuses the `blood` field (§2.2); the wave is the full easy
sweep, 10 cards (§10); rush actions are deferred to their own
mini-design (§9). Implementation notes beyond the draft: using an
in-play ability now rewinds the impulse to the acting Methuselah (p. 8)
— surfaced by 47th Street Royals; "only usable by a locked vampire"
became the `byVampire` usability rule (Wake with Evening's Freshness,
Forced Awakening) since allies may otherwise play requirement-free
minion cards; On the Qui Vive's ally rider is a marked TODO (CLAUDE.md
known deviations).

This is the last permanents family: non-vampire minions (allies) and
minion-attached life-bearing cards (retainers). The V5 pool has **20 ally
cards and 14 retainer cards**; this gate builds the kernel support and a
first wave of the simplest ones.

---

## 1. Rulebook facts (citations verified against the V5 PDF)

**Allies** (p. 11, p. 20, p. 22):
- Allies are minions other than vampires (p. 11). They act, block, and
  fight through the same machinery as vampires.
- Brought into play with the **recruit ally** action: undirected,
  **+1 stealth** default, cost as listed on the card (p. 22). On success
  the ally is placed in the controller's ready region **with its starting
  life in blood counters from the blood bank**, but **cannot act this
  turn** (p. 22). Allies brought into play by other means CAN act the
  same turn (p. 22, advanced).
- A ready ally's only basic action is **bleed** — no hunt (p. 19).
- When an ally loses its last life counter it is **burned** (p. 22).
  Allies never go to torpor; an effect that would send one to torpor
  burns it instead (p. 11).
- Damage on an ally **burns 1 life per point** — no mend decision, no
  wound state; aggravated damage is treated the same as normal (p. 31–32).
- If recruiting requires a Discipline and the ally enters play by other
  means, use the basic version (p. 22).
- Some allies play cards "as a vampire" (capacity 1, life = blood)
  (p. 11) — **deferred**, see §9.

**Retainers** (p. 11, p. 20, p. 22):
- Brought into play with the **employ retainer** action: undirected,
  **+1 stealth** default, cost as listed (p. 22). On success the retainer
  is placed **on the acting minion** ("the employer") with its starting
  life from the blood bank.
- No limit to retainers per minion; retainers **cannot be transferred**
  (p. 22).
- Burned when their last life is burned, or **when the employer is
  burned** (p. 11). (Torpor does not burn retainers — only burning the
  employer does.)
- Retainer damage output (Murder of Crows etc.) is **environmental
  damage** — not a strike, cannot be dodged (p. 31).
- Damage on a retainer burns life like an ally (p. 31–32).

---

## 2. State model

### 2.1 Allies are `MinionState` with a `kind` discriminant  (recommended)

```ts
export interface MinionState {
  kind: "vampire" | "ally";      // NEW
  // ... existing fields unchanged
}
```

**Why not a separate `AllyState` type:** allies act, block, get locked/
woken, enter combat, carry attached equipment/retainers, and are targets
of intercept/stealth math — every one of those code paths already speaks
`MinionState`. A parallel type would fork the whole minion machinery for
no modelling gain. The discriminant gates the few vampire-only rules
instead (hunt, torpor, disciplines, capacity drain, influence).

### 2.2 Life counters reuse the `blood` field  (DECIDED)

The rulebook itself says ally/retainer life IS blood counters from the
blood bank (p. 22). Storing ally life in the existing `blood` field means
`BloodBurned` / `BloodGained` events, cost payment, the conservation
replay in the fuzz harness, and the masked PlayerView all work unchanged.
Interpretation is by `kind`: the UI labels it "life" for allies.

Ally field conventions:
- `capacity` = starting life (reference value; the fuzz invariant
  `blood ≤ capacity` is **exempted for allies** — life may exceed
  starting life and does not drain off, p. 11).
- `disciplines` = `{}` (allies have none; discipline-gated card options
  simply never match).
- `inTorpor` is always false for allies (burned instead).
- `strength` / `bleedAmount` come from the printed card stats.

**Alternative considered:** a separate `life` field. Rejected because it
forks every event/consumer ("burn blood or life, as appropriate" would
need a second event vocabulary and a second conservation ledger) and
buys only naming clarity that a comment + UI label provide.

### 2.3 Retainers are `PermanentInPlay` + optional life

```ts
export interface PermanentInPlay {
  // ... existing fields
  life?: number;                 // NEW — present only on retainers
}
```

Retainers already fit the attached-permanent shape (statics like
`intercept` for Raven Spy / Revenant / Mr. Winthrop, lock-to-use
abilities, phase latches). They only lack life. New events (§3) adjust
it; at 0 the retainer is burned.

### 2.4 New flag: `cannotActThisTurn`

Set on an ally when the recruit action succeeds; cleared at the end of
that turn. NOT set when an ally enters play by other means (p. 22
advanced). Blocking is unaffected — the flag gates acting only.

### 2.5 Ally card text lives as a self-attached entry

An ally's printed abilities and statics (Double Deuce's +1 stealth,
47th Street Royals' burn-to-reduce-bleed, Double Deuce's unlock-phase
regen) need a home. Rather than inventing a parallel ability system for
minions, the ally card itself enters play as a `PermanentInPlay` entry in
the ally's own `attached` list. Everything then reuses existing
machinery: bearer statics apply to the ally, `abilityOptions`/
`useAbility` work, `usedThisPhase` latches work, and burning the ally
burns the entry with the rest of its attached cards. The engine loop is
untouched.

## 3. New events

```ts
| { type: "AllyEnteredPlay"; seat: SeatId; minion: MinionId; life: number }
| { type: "MinionBurned"; minion: MinionId }
| { type: "RetainerLifeBurned"; cardId: CardInstanceId; amount: number }
| { type: "RetainerLifeGained"; cardId: CardInstanceId; amount: number }
```

- `AllyEnteredPlay` mirrors `VampireEnteredPlay`; `life` is the from-bank
  grant (conservation: bank is an infinite source, same as hunt).
- `MinionBurned` is generic (vampires can be burned in the wider pool —
  diablerie, card effects). Applying it removes the minion, burns its
  attached cards (equipment + retainers, p. 11), and — if the minion is
  in the current combat — ends the combat ("no longer ready", p. 30).
- Ally life changes reuse `BloodBurned`/`BloodGained` (§2.2).

## 4. The two new actions

Both ride the **existing action-card machinery** exactly like equip
(`isEquipment` precedent in `engine.ts` resolveAction): the card is set
aside at announcement, cost (pool and/or blood) is paid at resolution
only on success, block/cancel returns it to hand.

- New handler flags: `isAlly` and `isRetainer` (peers of `isEquipment`).
- Both actions are undirected with **+1 inherent stealth** (p. 22) — via
  the existing `inherentStealth` announce param.
- On success:
  - Retainer → `PermanentEnteredPlay` attached to the acting minion,
    plus starting life (denormalized from the handler, like statics).
  - Ally → `AllyEnteredPlay`: a new `MinionState` (kind "ally", stats
    from the spec) joins the controller's `minions`, flag
    `cannotActThisTurn` set.
- Discipline-gated modes (Raven Spy `[ani]`/`[ANI]`) use the existing
  mode system; the mode chosen at announcement fixes which version
  enters play (basic if put into play by other means, p. 22 — moot until
  such an effect exists).

## 5. Legality changes (kind-gated, all in the legal-move generator)

| Rule | Gate |
| --- | --- |
| Allies cannot hunt (p. 19) | `hunt:` option only for `kind === "vampire"` |
| Allies never in torpor | `leave:` option never offered; wound path replaced by burn |
| Recruited this turn cannot act (p. 22) | no action options while `cannotActThisTurn` |
| Allies can bleed (p. 19) | existing `bleed:` option, uses printed `bleedAmount`; `bledThisTurn` applies |
| Allies can block | existing block options — no change |
| Card-text restrictions ("cannot block vampires") | per-card, not kernel |

## 6. Combat with allies

- Strikes, maneuvers, presses, strength: unchanged (frame code is
  already minion-generic).
- **Damage resolution forks at the mend step**: vampires get the
  mend/wound/torpor path; allies burn 1 life per unprevented point,
  automatically, no decision (p. 31). Prevention windows still open
  (card-text abilities like War Ghoul's).
- Ally at 0 life → `MinionBurned` → combat ends immediately (p. 30).

## 7. Retainer combat output (first vocabulary addition)

Murder of Crows / Crypt's Sons / Dread Mastiff: *"inflicts N (R) damage
on the opposing minion each round of combat during normal strike
resolution."*

New spec primitive on the permanent block:

```ts
combatRoundDamage?: { amount: number; ranged: boolean }
```

During the damage-resolution step, each retainer on a combatant with
this static adds a `PendingDamage` entry against the opposing minion
(source: null — environmental, cannot be dodged, p. 31), resolved with
the normal pair. Ranged versions apply at any range; non-ranged (Dread
Mastiff basic) only at close.

## 8. Spec vocabulary (`spec.ts`) additions

```ts
cardType: ... | "ally" | "retainer";

// on CardSpec:
ally?:     { life: number; strength: number; bleed: number; unique?: boolean };
retainer?: { life: number };

// PermanentStatics gains:
stealth?: number;               // bearer stealth (Double Deuce)
combatRoundDamage?: { amount: number; ranged: boolean };   // §7
pressPerCombat?: number;        // Dread Mastiff [ANI]: press credit each combat
opposingCannotCombatEnds?: boolean;  // Dog Pack: minions in combat with
                                     // the employer cannot strike: combat ends
```

`compile.ts` gains the per-type law: ally/retainer cards are action
cards (announce recruit/employ), +1 stealth, cost at resolution,
entry effects as §4.

## 9. Deferred (explicitly out of this gate)

- **"Enter combat as a Ⓓ action" (rush)** — War Ghoul, the Vozhds,
  Twisted Bloodhound, Aggressive Corpse, Rotting Behemoth, Freakish
  Conglomeration. Requires directed actions that target a *minion*
  (ActionFrame.target is currently a SeatId). Worth its own mini-design;
  it is also the shape diablerie and rescue-from-torpor need.
- **"Plays cards as a vampire"** allies (p. 11) — Spectral Servitor,
  Vozhd of Juiz de Fora.
- Cross-player uniqueness contests (existing project-wide non-invariant).

## 10. The wave (DECIDED: full easy sweep, ~10 cards)

Each card lands with a deterministic scenario test before its id flips
in `config/supported.json`. Tranche 1 proves each kernel mechanism with
the simplest possible card; tranche 2 sweeps the remaining
vocabulary-fit cards.

**Tranche 1 — one card per mechanism:**

| Card | Why it's first |
| --- | --- |
| **Political Ally** | Pure-stats ally (unique mortal, 1 life, 0 str, 3 bleed) — exercises recruit, cannot-act-this-turn, ally bleed, ally block, ally burned by damage |
| **Revenant** | Simplest retainer (2 life, +1 intercept, blood cost 1) |
| **Mr. Winthrop** | Unique retainer, +1 intercept, no cost |
| **Raven Spy** | Discipline-moded retainer ([ani] 1 life / [ANI] 2 life), +1 intercept |
| **Murder of Crows** | `combatRoundDamage` ranged — exercises §7 |

**Tranche 2 — the rest of the easy sweep:**

| Card | What it adds |
| --- | --- |
| **Dread Mastiff** | `combatRoundDamage` non-ranged (close only); [ANI] adds `pressPerCombat` |
| **Dog Pack** | `opposingCannotCombatEnds` static — checked where combat-ends strikes are enumerated |
| **Double Deuce** | Ally self-entry statics (§2.5): +1 stealth; own-unlock-phase latch (mandatory: gains 1 life if ≤ 2) |
| **47th Street Royals** | Ally ability in the reaction window: burn self to reduce a bleed against you by 3 (existing bleed-modification path, negative delta) |
| **Homunculus** | Employer unlock ability **during any Methuselah's unlock phase** — the one latch-scope extension in the wave (existing latches are own-phase only); [PRO] 2 life |

Kernel tests (tests/engine/): recruit blocked → card returned + no ally;
employ on locked-vs-ready minion legality; ally lethal damage → burned +
combat ends + attached cards burned; employer burned → retainer burned;
retainer at 0 life burned; recruited ally blocks same turn but cannot
act. Fuzz: add the wave to the fuzz decks; invariants updated — ally
life ≥ 0 (capacity cap exempted), conservation replay counts
`AllyEnteredPlay`/`RetainerLife*` as bank flows.

## 11. Decisions log

Resolved with the owner, 2026-07-19:

1. **Life storage** — reuse `blood` (§2.2). ✔
2. **Wave size** — full easy sweep (~10 cards, §10). ✔
3. **Rush actions** — deferred to a follow-up mini-design (§9). ✔

Remaining before code: owner reads this doc and signs off.
