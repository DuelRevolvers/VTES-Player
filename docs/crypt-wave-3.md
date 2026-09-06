# Crypt wave 3 — combat and blocking

2026-09-03. **Crypt 59/217 supported. 177 of 217 crypt cards play
correctly; 40 ability cards remain.**

12 cards. One genuinely new idea, and a good deal that was already built.

---

## 1. The new idea: a condition on WHO YOU ARE FIGHTING

Kevin Jackson ("+1 strength in combat with a Brujah"), Ragnar Nordstrom
("with an ally or younger vampire") and Roy ("with titled vampires") all
condition a static on the *other combatant*.

`ConditionalStatic.inCombatWith` is that condition, and
**`opposingCombatantOf(state, minion)` reads it off the live combat frame
on every evaluation — nothing is stored.** That is the rule
`docs/retainer-wave-design.md` §1 states, for the reason it states it: a
combat ends by a strike, by a card, by a combatant leaving play, or by the
frame being popped from three sites, and **a flag that must be cleared at
all of them is one that will one day survive one of them.** Read on
demand, the bonus cannot leak out of a fight that is over.

`younger` compares DERIVED capacity against the bearer's, so a granted
point counts on both sides.

**Ragnar's "an ally OR younger vampire" is two entries, not one
intersection** — the union reading recorded in
`docs/opposing-statics-design.md`, where the intersection would have made
the clause nearly inert (an ally has no capacity to be younger *than*).

### 1.1 The mirror half

Kevin's second sentence — "Brujah get +1 strength in combat with him" — is
a bonus the bearer hands to *whoever is fighting them*, which is the
opposite direction from every other static here.
`PermanentStatics.opposingStrengthBonus` plus `opposingGrantedStrength`,
read off the same frame. Same helper, other side.

---

## 2. What came free

- **Marialena** — "if she is blocked, she burns 1 blood before block
  resolution" is `blockedToll`, Phantasmagoria's static, word for word.
  Nothing but a field. **Reading on record: a FAILED attempt costs
  nothing** — "if she is blocked" is not "if a block is attempted", the
  same reading Terrifying Visage takes.
- **Adrino Manauara** — "1 press (mandatory) each combat, only usable to
  continue combat" is `continuePressPerCombat`, built for Righteous
  Blade. One field. (The first draft of this wave invented a new clause
  and a new hook for it before checking; the static was already there.)
- **Egidia Arrú** — `onCombatLeave`, built for Dead Pool.
- **Flávio Gonçalves** — prints Treasured Samadji's clause exactly.
- **Roy's discard-phase lock** — `onDiscardPhase`, built for The Coven.
  Automatic, because the card says "lock him", not "you can" (the Rebel
  precedent).

---

## 3. Small extensions

- **`grantsStrikePerCombat`** gained `combatEnds` and a `bloodCost`, for
  Agnieszka. The cost gates the OPTION as well as being paid — a price
  the bearer cannot pay is not a choice.
- **`setHandStrikesAggravatedFor(minion)`** — the existing op takes a
  `CardPlayFrame`, which an ability of a card in play does not have. The
  `addRoundStrengthTo` shape; the frame version now delegates to it, so
  there is one implementation.
- **`preventForOther`** — Opikun and Huldu prevent damage to *another*
  minion, which is the bystander prevention `preventDamageFor` was built
  for (Martyr's Resilience), offered as an ability of a card in play.
  Opikun's "non-aggravated" is a gate on OPTIONS, the `noPreventBy`
  precedent: a card that provably cannot prevent this damage is not
  offered.

---

## 4. Noluthando, and a parenthetical that describes existing behaviour

"Inflicts +1 damage with ranged strikes **(even at close range)**."

A ranged strike already works at close range — the parenthetical is the
card confirming the rule, not asking for one. So the only new thing is
the bonus, added at `pushPendingDamage`, the single chokepoint the
round-recurring wave established, so it reaches the damage however the
strike was declared.

**That is the fifth card in this project whose parenthetical describes
existing behaviour** (after "the minion chooses a strike again" ×4).
Reading one as an instruction is how a re-entrancy bug gets written.

---

## 5. Two test fixtures that measured the walk, not the gate

Both "not offered when they cannot pay" tests failed by offering the
option — and neither was a code bug.

**A vampire at 0 blood MUST hunt (p. 21).** The test walker answers that
mandatory hunt, the vampire gains blood, and the ability then becomes
correctly available. The fixture was feeding the very resource it claimed
was missing.

Fixed by taking the vampire out of the mandatory-hunt path: Opikun is
**locked** (so she cannot act at all), and Agnieszka **defends** rather
than attacks. This is the walker-plays-the-board trap for the third time
(`docs/path-cards-design.md` had `leave:V2`, wave 2 had the rush target),
and it is worth stating as a rule: **a fixture that sets blood to 0 has
also enabled a mandatory action.**

---

## 6. Deferred, with reasons

- **Faruq, Sergio** — both filter on *your corruption counters* on the
  other minion (a combat restriction and a block toll respectively). The
  corruption subsystem exists; the filter on these two statics does not.
- **Parijat** — a block toll paid in LIBRARY CARDS, and about *other*
  minions (wraith/zombie allies) rather than the bearer.
- **Tommaso** — ends a combat from outside it, for a wraith/zombie ally.
  `endCombatFromOutside` exists; the once-per-turn, blood-paying,
  ally-scoped wrapper does not.
- **Djeneba, Algirdas** — play-cost modifiers aimed at *the opposing
  combatant*. `whileBearerEngaged` gates on the PAYER being engaged,
  which is close but not the same question; worth doing deliberately.
- **Abraham, Kasim, Phaibun, Roger** — all four are the
  **discard-a-card-for-a-bonus** family, which is C4's one-primitive
  group (6 cards with the two from the "other" list).
- **Aemilius, Abderrahim** — an unlock-phase damage choice and an
  action-window stealth grant; neither is combat.
