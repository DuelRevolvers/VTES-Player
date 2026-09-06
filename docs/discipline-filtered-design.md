# Discipline-filtered effects

Status: **design + implementation** (2026-08-30). Chosen by pool survey;
it also closes the deferral recorded against **Hide the Mind** in
`docs/modifier-or-combat-design.md` ("cancel a card *by the discipline it
requires* — needs the handler to expose a pending card's disciplines,
which unlocks the other discipline-filtered cancels").

## 1. The shape

A family of cards that reason about **the Disciplines another card
requires**, rather than about the cards themselves:

- "Damage from this strike cannot be prevented by cards requiring
  Fortitude [for]" — Blood Fury, Blood Rage, Soul Burn, Soulgrinder.
- "Cancel a combat card requiring Auspex [aus] as it is played" —
  Hide the Mind.
- "Cards requiring Dominate or Presence cost other minions +1 blood" —
  Libertas (deferred, §6).

`CardMode.discipline` has always held exactly this information — a
string, an array meaning "any one of", or `{ all: [...] }`. What was
missing was any way to **ask** for it: the compiler read it to decide
whether a minion could play the card and then dropped it on the floor.

## 2. The enabling query

**`CardHandler.requiresDisciplines?(mode, variant?): string[]`**, added
centrally in `compileSpec`, so every spec-compiled card gets it for free
and no card author has to remember it. It flattens all three shapes of
`CardMode.discipline` into a plain list of KRCG abbreviations.

Then, following the **denormalization precedent** (`PermanentCostSource`
on the card in play, `pending.isMaster` on the frame): the engine calls it
once, when it pushes the `cardPlay` frame, and stores the answer as
**`CardPlayFrame.requires: string[]`**. A cancel-as-played effect reads
`ctx.pendingCard.requires` — a plain array read, no registry lookup, no
handler-lookup API on `PlayContext`.

## 3. Prevention filtered by required Discipline

Damage carries the restriction, not the strike, because prevention
happens two steps later:

- **`Strike.noPreventBy?: string[]`** — set by the strike primitive's
  rider, flows through `inflict()` into
- **`PendingDamage.noPreventBy?: string[]`** — read at prevention time.

Three enumeration sites had to agree, and all three are gates on
**options**, not on the op — a card that cannot legally prevent this
damage is never offered:

1. `combat.damageResolution` in `compileCombatCard` (the ordinary case:
   the victim prevents their own damage);
2. `outsidePreventOptions` (Martyr's Resilience — an `[aus][for]`
   bystander preventing for someone else, p. 28);
3. the built-in `prevent:credit` option — see the deviation below.

It has real teeth today: six supported cards prevent damage and require
Fortitude — Diversion, Hidden Strength, Indomitability, Martyr's
Resilience, Soak and Touch of Valeren.

### Recorded deviation: prevention CREDITS are not filtered

`CombatFrame.preventCredits` is a pair of counts, not a list of cards, so
a credit has forgotten which card granted it. Filtering it would mean
carrying the granting card's Disciplines alongside every credit.

**The only card in the V5 pool that grants a prevention credit is
Obedient Flesh, which requires `[dom][pro]`** — so no filter written
against Fortitude could ever bite on a credit today, and the refactor
would buy nothing. `tests/cards/discipline-filtered.test.ts` asserts that
no credit-granting spec requires a Discipline that any `noPreventBy` card
names; a future card that breaks the assumption fails that test rather
than silently preventing damage it should not.

## 4. Weapon damage nullified for a round

"The opposing vampire's strikes with weapons inflict no damage this
round" (Blood Fury, Blood Rage, Soul Burn) is
**`CombatFrame.weaponDamageNullified: { acting, opposing }`**, reset with
`handStrikesAggravated` and `strengthBonusRound` when a round begins.

It is checked in `inflict()`, keyed on the **striking** side, and only for
`strike.source === "weapon"` — a card-granted fixed-damage strike
(`strikeDamage`, source `"card"`) is not a weapon and is unaffected. The
strike still *happens*; it just inflicts nothing, so a weapon's non-damage
riders are untouched.

The flag is set on the side **opposite** the player: the card says "the
OPPOSING vampire's" strikes.

## 5. Cards

| id | card | |
|---|---|---|
| 100201 | Blood Fury | `[tha]` hand strike +1, no-Fortitude, weapons nullified · `[THA]` +2 |
| 100208 | Blood Rage | as above at +0 / +1, no blood cost |
| 101829 | Soul Burn | `[tha]` 1R damage, same two riders · `[THA]` 2R |
| 102340 | Soulgrinder | `[pot]` or `[tha]` hand strike +2 · superior adds no-Fortitude |
| 100921 | Hide the Mind | the Discipline-filtered cancel — below |

### Hide the Mind is bespoke, and deliberately so

Its two modes are:

- `[obf]` **[COMBAT]** cancel a **combat card** requiring Auspex as it is
  played, cost not paid;
- `[OBF]` **[ACTION MODIFIER]** cancel a **reaction card** requiring
  Auspex as it is played, cost not paid.

That is not the `modifierOrCombat` split. That split asks *which window a
mode acts in*; here **both** modes act in the same window —
`card.asPlayed`, inside another card's as-played period — and differ in
*which kind of card they may cancel*. This is exactly the reason **Sudden
Reversal** is bespoke ("its window fits no spec shape"), so Hide the Mind
joins it in the bespoke tail rather than bending the split rule.

Reading on record: the *basic* mode still requires being in the combat
and the *superior* still requires being the acting minion in an action —
the bracketed card-type tags are the printed statement of when each mode
is playable, and dropping them would let a bystander cancel reactions.

## 6. Deferred: Libertas (101100)

"Cards requiring Dominate [dom] or Presence [pre] cost other minions +1
blood while this Anarch is acting, attempting to block or in combat."

The query is now available, but the *cost* half is not: `spec.bloodCost`
is read directly at roughly fifteen affordability and payment sites. A
Discipline-keyed cost modifier means replacing every one of them with a
single `costToPlay(spec, mode, minion, state)`, which is its own gate and
wants its own pass — the same shape as, and a good companion to,
`PermanentStatics.rescueDiscount`. Not folded in here.
