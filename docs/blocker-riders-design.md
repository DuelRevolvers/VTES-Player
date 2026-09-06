# Intercept reactions and what they carry into the combat

*Instinctive Reaction (100995), Precognition (101475), Truth in Darkness
(102284), Form of the Bat (102223), Night Terrors (102254).*

## 1. The cluster

The remaining intercept reactions are all the same shape: **win the block,
and carry something into the combat that follows**. That rider mechanism
(`ActionFrame.blockerCombatRiders`) was built for Spirit's Touch and One
With the Land and closed as a gate; these five extend it with one field
each, which is the cheap kind of wave.

| Card | Wins the block by | Carries into the combat |
|---|---|---|
| Instinctive Reaction `[ANI]` | +1 intercept | 1 optional maneuver |
| Precognition `[AUS]` | +1 intercept | prevent 1 damage, **first round only** |
| Truth in Darkness `[OBL]` | +1 intercept | may burn 1 blood to unlock, after block resolution |
| Form of the Bat `[PRO]` | +1 intercept (reaction mode) | 1 maneuver, and **cannot use equipment** |
| Night Terrors `[OBF][PRE]` | reducing the actor's stealth to **0** | may strike: combat ends, first round |

Form of the Bat's other half is an action MODIFIER pointing the same
mechanism the other way (the actor's own rider), which is why it is in
this cluster rather than the fail-block one.

## 2. `blockerCombatRiders` gains four fields

```ts
prevent?: number;        // Precognition — first round only (§3)
noEquipment?: boolean;   // Form of the Bat
unlockForBlood?: number; // Truth in Darkness
combatEndsStrike?: boolean; // Night Terrors
```

`actorCombatRider` gains the mirror of one of them, `noEquipment`, for
Form of the Bat's modifier mode. Both sides already funnel through the
same place in `resolveBlockAttempt`, so each field is one line next to its
sibling.

## 3. Three of them needed a scope the frame did not have

- **Precognition's prevention is FIRST ROUND ONLY.**
  `CombatFrame.preventCredits` is combat-long, so this gets its own
  counter, `preventCreditsFirstRound`, offered only while
  `cf.round === 1` and **spent before** the combat-long one — it is the
  use-it-or-lose-it resource, the same rule `closeManeuvers` follows.
- **Truth in Darkness offers an option, not an effect.** "They can burn 1
  blood to unlock after block resolution" is a choice the blocker makes
  once the combat has begun, so the rider sets
  `CombatFrame.unlockForBlood` and the `beforeRange` window offers a
  built-in `unlock:blood` to that side — the shape `maneuver:credit`
  already uses.
- **Night Terrors grants a STRIKE.** `StrikeKind` was `"hand"` and
  nothing else: the built-in strike option hard-coded `HAND_STRIKE`. It
  gains `"combatEnds"`, offered to the blocker in the first round when
  `cf.grantedCombatEnds` says so. "Strike: combat ends" already exists as
  a card effect; this is the same strike arriving from a rider instead of
  a card.

## 4. "Reduce the acting minion's stealth to 0"

> "(The acting minion can still increase their stealth.)"

The parenthetical is the whole implementation. `currentStealth` is a
**fold over the event log**, so "reduce to 0" is an ordinary
`StealthModified` with `delta = −(current stealth)`: everything played
afterwards still adds on top, exactly as the card says. Nothing needs a
floor, a clamp, or a new kind of modifier — which is the same reason
`modifyStealth` needed no special case for "+1 stealth played by somebody
else" two waves ago.

Recorded as `setStealthZero`, and Visions of Zapathasura's "reduce a bleed
against you to 0" will want the same trick on `currentBleed`.

## 5. A real gap: a dual-typed card whose MODIFIER half was unreachable

`cardType: "modifierOrReaction"` exists, and the compiler picks its
candidate minions **once, before the per-mode loop**:

```ts
if (spec.cardType === "actionModifier") { /* the acting minion */ }
else { /* reactions: another Methuselah's minions */ }
```

so a `modifierOrReaction` card is treated as a **reaction only**. Both
cards that used the type until now (Scalpel Tongue, Ominous Chorus) are
polling-step cards handled by an earlier branch, so nothing noticed.

**Form of the Bat is the first card with a genuine action-modifier mode
on that type**, played by the acting minion — and it would never have been
offered. The fix is the pattern this compiler already uses twice
(`byLockedMinion`, `byOtherVampire`): **widen the candidate list if any
mode wants it, then gate per mode.** `CardMode.role: "modifier" |
"reaction"` says which half a mode belongs to, and it is required on a
`modifierOrReaction` mode that is not polling-only, so the next such card
cannot silently fall into the same hole.

This is the same failure family as the `modifyVotes` / `restrictVotes` /
Scalpel Tongue drift recorded in CLAUDE.md — a card type whose two halves
are enumerated in different places, where only one place was taught about
a new case.

## 6. "Only usable if a minion controlled by your predator is acting"

Instinctive Reaction's own gate. `predatorBleedingYou` already existed and
is narrower (a bleed, aimed at you, three or more Methuselahs);
`predatorIsActing` is the plain form: the acting minion's controller is
this seat's predator, whatever the action.

## 7. Rulebook citations

- p. 12 — who may play reaction cards, and when.
- p. 25 — the acting minion locks at announcement; block attempts.
- p. 26 — stealth and intercept are compared, and modifiers are only
  offered when they are needed.
- p. 27 — a successful block starts combat; the blocker locks.
- p. 30 — choosing strikes; the acting minion chooses first.
- p. 32 — "strike: combat ends" still runs the End of Round step.
