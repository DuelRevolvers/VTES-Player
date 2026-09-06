# Frenzy — Gate 7 (IMPLEMENTED)

Status: APPROVED — implementing (doc-per-gate; owner makes the scope calls).

## What "frenzy" actually is

The roadmap guessed frenzy was a persistent minion state; the V5 pool shows
otherwise. **No card sets a lasting "frenzied" flag.** "Frenzy." is a
card *keyword* whose only cross-card relevance is that other cards can
cancel a frenzy card (Meditative Grove) or make a vampire immune to them
(Tranquility Shield). Each frenzy card's own effect is an ordinary combat
effect described in its text. So the gate delivers (a) the keyword hook and
(b) the two cards whose effects fit engine vocabulary.

## Mechanic

- Spec flag `frenzy` → `CardHandler.isFrenzy` (the keyword hook for future
  cancel/immunity cards). Wired in `compileSpec` for every card type.
- `CombatFrame.restrict[side] = { maneuver, press, equipment }` — per-side
  combat restrictions, checked by: the maneuver-credit and press-credit
  built-ins (engine), card-based maneuver/press modes and the first-round
  gate (compile), and weapon abilityOptions (compile).
- Primitive `restrictOpponent { maneuver?, press?, equipment? }` (combat,
  before range) → op `restrictCombatOpponent`, which sets the flags on the
  side opposite the player.
- Usability rule `onlyFirstRound` (Terror Frenzy) alongside the existing
  `onlyAfterFirstRound`.

## Cards shipped

- **Rage of Apedemak** (102336, frenzy, `[ani]`/`[pot]`): "hand strikes
  inflict +1/+2 damage this combat", modeled as `addStrength` (+strength is
  the only input to hand-strike damage); once per combat.
- **Terror Frenzy** (101960 basic, frenzy, `[ani]`, first round only): the
  opposing minion cannot maneuver to close, press to continue, or use
  equipment this combat.

## Deviations / deferred

- Rage of Apedemak's "+1 hand size this combat" is cosmetic in the engine
  (hand size matters only at discard) and is unmodeled.
- Terror Frenzy **superior** ("combat cards cost the opposing vampire +1
  blood") needed an opposing-cost modifier — **DONE 2026-08-31**, see
  `docs/play-cost-design.md` §6. Until then this card was marked
  supported with only its basic mode implemented.
- **Tranquility Shield — DONE 2026-09-01**, see
  `docs/round-recurring-combat-design.md` §6. Per-combat immunity is
  `CombatFrame.frenzyImmune` (a gate on OPTIONS), and the retroactive
  cancel is provenance rather than undo: `CardPlayFrame.isFrenzy` plus
  `CombatFrame.frenzyRestrict` and `PlayCostMod.fromFrenzy`. **Which
  vampire a frenzy card is used ON** is derived from the mode's own
  effects by `frenzyTargetSide` in compile.ts — that is the piece this doc
  was missing.
- **Meditative Grove — DONE 2026-09-01**, see
  `docs/blood-locations-design.md` §6. It needed `abilityOptionsFor` to
  admit an opted-in handler in the `card.asPlayed` window
  (`CardHandler.abilityInAsPlayed`), `PlayContext.pendingCard` filled
  there, and the "used on" answer denormalized onto
  `CardPlayFrame.frenzyOnOpponent`. **This gate is now fully closed.**
- Deep Song (superior rush "considered the acting minion during that
  combat") is left for the one-off phase and is not a frenzy problem. The bespoke `.44 Magnum` weapon does not honor the
  equipment restriction (its abilityOptions predate the flag); the
  data-driven weapons do. Fold in when .44 migrates to the generic shape.
