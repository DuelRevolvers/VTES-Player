# Combat effects that recur every round

*Bear's Skin (100145), Carrion Crows (100301), Flesh of Marble (100749),
Weather Control (102164), Tranquility Shield (102362).*

## 1. Why these five are one cluster

Combat has not had a dedicated sweep since the strike-effects gate, and a
survey of the 20 unsupported combat cards found the largest coherent
family: **"Only usable before range is determined"** cards that install
something on the combat frame which then **fires again every round**.

`CombatFrame` already distinguishes two lifetimes and only two:

| lifetime | example fields |
|---|---|
| whole combat, applied once | `strengthBonus`, `restrict`, `allDamageAggravated`, `preventCredits` |
| this round, reset at the round boundary | `strengthBonusRound`, `handStrikesAggravated`, `preventAllFrom`, `closeManeuvers` |

Nothing is **combat-long and recurring** — a rate rather than a pool, or a
rider that fires once per round for the rest of the combat. That is the
gap all five cards fall into, and it is why each of them reads "this
combat, … each round".

| Card | What recurs |
|---|---|
| Bear's Skin `[ANI][PRO]` | "can prevent 1 damage **each round**" |
| Tranquility Shield `[for]`/`[FOR]` | "can prevent 1 (2) damage **each round**" |
| Carrion Crows `[ani]`/`[ANI]` | "the opposing minion takes 1R (2R) environmental damage **each round** during normal strike resolution" |
| Weather Control `[tha]`/`[THA]` | "both combatants and each retainer on them take 1 unpreventable environmental damage **before range is determined each round**" |
| Flesh of Marble `[pro]`/`[PRO]` | "**in a given round**, additional damage after the first is automatically prevented" |

Bear's Skin's *inferior* mode is the control case that proves the point:
"**This round**, this vampire gets +1 strength and can prevent 1 damage"
is the existing `combatCredits` primitive, unchanged. Only the superior
mode needs anything new.

## 2. A prevention RATE, not a pool

`preventCredits` is a combat-long **pool**: spend it and it is gone.
`preventCreditsFirstRound` is a round-1 pool. "Can prevent 1 damage each
round" is neither — it is a **rate that refreshes**, so it needs its own
pair of fields:

- `CombatFrame.preventPerRound` — the rate, granted once, never reset.
- `CombatFrame.preventPerRoundUsed` — spent this round, reset at the
  round boundary beside `handStrikesAggravated`.

**Spend order: shortest-lived first.** `preventCreditsFirstRound` (gone at
the end of round 1) → the per-round rate (gone at the end of this round)
→ `preventCredits` (lasts the combat). This is the same rule
`closeManeuvers` follows and the same one already written for the
first-round pool; the rate simply slots into the middle.

The offer is a single `prevent:credit` option whose label sums whatever
is available, so a vampire holding two kinds of credit still sees one
button — the player is choosing to prevent a point, not choosing which
accounting bucket pays for it.

## 3. Damage that recurs each round

`PermanentStatics.combatRoundDamage` already expresses "inflicts N (R)
damage on the opposing minion each round during normal strike resolution"
— but only for a **retainer**, read off the bearer's attachments at the
one site in `resolveStrikes`. Carrion Crows prints the same sentence from
a combat card, and Weather Control prints its sibling one step earlier in
the round.

`CombatFrame.roundDamage` is a list of riders, each field traceable to a
printed clause:

```ts
interface CombatRoundDamageRider {
  from: "acting" | "opposing";   // whose card — "the opposing minion" is relative
  targets: "opposing" | "both";  // Carrion Crows | Weather Control
  amount: number;
  ranged: boolean;               // "1R" applies at any range (p. 31)
  when: "beforeRange" | "strikeResolution";
  retainers?: boolean;           // "…and each retainer on them"
  unpreventable?: boolean;
  escalate?: boolean;            // "increased by 1 in each subsequent round"
  startRound: number;            // the baseline `escalate` counts from
}
```

`startRound` is what makes `escalate` a pure function of the frame rather
than a counter that has to be ticked: the amount is
`amount + (round − startRound)`, so a card played in round 2 escalates
from round 2, and a reload computes the same number.

The two `when` values land at the two places the rulebook puts them:
`strikeResolution` runs in `resolveStrikes` beside the retainer sweep and
only in a **normal** strike round, not an additional sub-round (p. 31);
`beforeRange` runs as each new round opens — **and once immediately when
the card is played**, because the card is played *in* that window and the
round it is played in has already reached it.

**Environmental damage has `source: null`**, as retainer output already
did, so it cannot be dodged and `preventAllFrom` (which is keyed on the
damaging side) does not touch it. It goes through `pushPendingDamage`, the
single chokepoint, so Dawn Operation's "all damage this combat is
aggravated" still applies to it without a second site knowing about it.

**Retainers are not `PendingDamage` victims** — that field is a
`MinionId` and a retainer is a `PermanentInPlay` — so "each retainer on
them" burns retainer life directly through the existing
`burnRetainerLife`. That is honest here precisely because Weather
Control's damage is *unpreventable*: there is no window to skip.

## 4. Unpreventable damage skips the window entirely

`PendingDamage` gained `unpreventable?: boolean`. The only thing the
damage-resolution window contains is prevention — prevention cards
(`combatWindowFor` sends nothing else there), prevention credits, and
in-play prevention abilities — so damage that cannot be prevented has no
decision in it. Rather than open a window whose whole option list is
"Pass", such an item is **resolved in the drain step** described below.

This is the same reasoning as the recorded `combat.damageResolution`
deviation (the cycle carries only seats that can actually play): a window
with no content is a decision that costs a click and changes nothing.

## 5. Flesh of Marble: prevention that reads what already landed

> "If a damage is successfully inflicted on this vampire in a given round,
> any additional damage inflicted on this vampire in the same round is
> automatically prevented."

The trigger is damage **successfully inflicted**, i.e. damage that
survived prevention and was applied — not damage queued. So this cannot
be checked at `pushPendingDamage`: both strikes push before either
resolves, and at push time nothing has landed yet.

Two pieces:

- `CombatFrame.damageTakenThisRound` — points actually applied to each
  combatant this round, reset at the round boundary. Bumped in
  `resolveCombatDamage`, a one-line wrapper that every combat damage
  application now goes through (the `pushPendingDamage` lesson: one
  chokepoint, not two).
- `CombatFrame.autoPreventAfterFirst` — `"nonAgg"` at `[pro]`, `"all"` at
  `[PRO]`, per side.

The check runs in **`drainAutoPrevented(cf)`**, called at the top of the
`damageResolution` settle case. It pops items off the head of the queue
while they need no decision — auto-prevented (emit `DamagePrevented`,
discard) or unpreventable (apply now) — and reports progress, so the
window only ever opens on an item that someone could actually answer.
Placing it in settle covers both entries into the step: the first item of
the round, and every subsequent item after one resolves.

**"Aggravated damage cannot be prevented this way"** at the inferior is
the reason `autoPreventAfterFirst` is a union rather than a boolean; the
superior prints the exception away.

## 6. Frenzy immunity — closing a recorded deferral

`docs/frenzy-design.md` deferred Tranquility Shield for want of
"per-combat immunity" and "cancel the effects of frenzy cards already
used on this vampire". The `isFrenzy` keyword hook has existed since that
gate; this wave supplies the other two halves.

> "This combat, frenzy cards cannot be used on this vampire; cancel the
> effects of frenzy cards that have already been used on this vampire this
> combat."

**Prospective — `CombatFrame.frenzyImmune`.** A frenzy card's mode is not
offered when the vampire it would be used **on** is immune. Which vampire
that is comes from the mode's own effects, not from a list of card names:
a mode carrying `restrictOpponent` or `combatCostModOnOpponent` is used on
the *other* combatant; any other frenzy mode is used on its player. Both
frenzy cards in the pool are covered — Terror Frenzy is opponent-directed
in both modes, Rage of Apedemak is a self-buff and stays playable against
a shielded vampire, which is right: it is not used *on* them.

**Retroactive — provenance, not undo.** Cancelling an arbitrary already-
applied effect is not something an event-sourced engine can do in general.
What it can do is record which effects came from a frenzy card and remove
exactly those. `CardPlayFrame.isFrenzy` is denormalized at push, beside
`isMaster`/`isCombat`/`isReaction`, and the two ops that apply a frenzy
card's effect to the opposing combatant tag what they set:

- `CombatFrame.frenzyRestrict[side]` — "the flags in `restrict[side]` were
  set by a frenzy card".
- `PlayCostMod.fromFrenzy` — for Terror Frenzy superior's cost surcharge.

`shieldFromFrenzy` clears both for its own side. Since the only frenzy
effects the pool can aim at another combatant are those two, the cancel is
complete today; a future frenzy card with a third opponent-directed effect
must tag it the same way, and the classification test in
`tests/cards/round-recurring-combat.test.ts` walks every `frenzy: true`
spec so a new one cannot land unclassified.

**Meditative Grove (102252) wants the same question** — "cancel a frenzy
card as it is played on a Salubri you control" — from the `card.asPlayed`
window rather than from inside the combat. It is a Master and out of this
wave, but the "used on" rule above is the piece it was missing, and
`CardPlayFrame.isFrenzy` is the read it needs.

## 7. Rulebook citations

- p. 28 — combat cards, and who may play them.
- p. 29 — the round: before range, range, strikes, damage, end of round.
- p. 30 — ranged strikes work at any range; a combat can end mid-round.
- p. 31 — damage resolution and prevention; retainer output is "each round
  during normal strike resolution"; the victim's controller decides first.
- p. 32 — additional strike sub-rounds; End of Round still occurs.
- p. 34 — aggravated damage cannot be mended and burns a wounded vampire.

## 8. Readings on record

1. **A `beforeRange` round rider fires in the round it is played.** The
   card is played inside the before-range window, so waiting for the next
   round would make Weather Control do nothing in the round it was cast —
   and the card says "each round this combat", with no exclusion.
2. **Weather Control hits its own player.** "Both combatants" names no
   exemption, and the escalating superior is plainly a mutual-destruction
   card.
3. **Flesh of Marble counts damage per victim, not per source.** "A damage
   is successfully inflicted on this vampire" — one point applied from any
   source arms it for the rest of the round, including a retainer's or an
   environmental one.
4. **Rage of Apedemak remains playable at a frenzy-shielded vampire's
   opponent.** It buffs its own player; "used on this vampire" is not
   satisfied. Flagged as a reading rather than a citation — the rulebook
   defines no "used on".
