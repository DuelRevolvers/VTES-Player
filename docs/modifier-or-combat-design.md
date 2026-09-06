# Dual-purpose cards: action modifier *and* combat card

Status: **design + implementation** (2026-08-29). Opens the sweep of the
241 unsupported library cards by taking the cheapest coherent family in
it.

## 1. The family

Seven cards in the V5 pool are printed as **Action Modifier/Combat**: one
discipline level is an action modifier, the other is a combat card.

| id | card | inferior | superior | status |
|---|---|---|---|---|
| 101913 | Swallowed by the Night | +1 stealth | maneuver | ✅ |
| 101542 | Rapid Change | +1 stealth | strike: combat ends | ✅ |
| 102342 | Swift Cover | strike: dodge | +1 stealth | ✅ |
| 101610 | Resist Earth's Grasp | press, or maneuver with 1 optional press | +1 stealth | ✅ |
| 102224 | Form of the Cobra | strike: steal 1 blood | +1 stealth, even if not needed | ✅ |
| 102255 | Obedient Flesh | +1 stealth, allies get −1 intercept | before range: +1 strength, 1 maneuver, prevent 1, one per round | deferred (§4) |
| 100921 | Hide the Mind | cancel a combat card requiring [aus] | cancel a reaction card requiring [aus] | deferred (§4) |

Five of the seven need **no new effect primitives at all** — every effect
they use was already built for other cards. What was missing was only the
ability to say "this card is both".

## 2. `cardType: "modifierOrCombat"`

`compileByType` picks one compiler per card, and the two relevant
compilers already encode a lot of law each: `compileCombatCard` knows the
combat windows, the per-round/per-combat limits, range gating and strike
commitment; `compileModifierOrReaction` knows who may play a modifier,
the once-per-action rule and the p. 26 "only when needed" gates.

Rather than merge them, the spec is **split by mode** — each mode is a
combat mode iff `combatWindowFor(mode)` returns a window — and each half
is handed to the compiler that owns it. Options come from both halves
(their windows never overlap), and a play resolves through whichever half
owns the chosen mode. That is the whole implementation:

```ts
const combat   = compileCombatCard({ ...spec, cardType: "combat",         modes: combatModes });
const modifier = compileModifierOrReaction({ ...spec, cardType: "actionModifier", modes: modifierModes });
```

The same split would serve an Action/Combat card (there are two in the
pool) without change.

## 3. `evenIfNotNeeded`

Form of the Cobra's superior is "+1 stealth, **even if stealth is not yet
needed**" — explicitly overriding the p. 26 rule that a stealth modifier
is only legal once a block attempt makes it matter. That rule lives in
`effectsLegal`, so the override is a mode-level usability rule that skips
that one check. Its test plays the card with no block attempt underway
and asserts the stealth landed, which is the whole point of the card.

## 4. The two deferred, and why

- **Obedient Flesh** (102255) needs two things that do not exist: an
  action-scoped intercept penalty aimed at *allies* ("allies get −1
  intercept" for the duration of the action), and a "this vampire can
  prevent 1 damage this round" credit granted by a combat card rather
  than by a card in play. Both are real mechanics worth building
  properly; neither is a one-liner.
- **Hide the Mind** (100921) cancels a card *by the discipline it
  requires* ("cancel a combat card requiring Auspex as it is played").
  `cancelPendingCard` exists, but nothing can currently ask a pending
  card which disciplines its chosen mode requires. That is a small
  addition to the handler surface, and it unlocks the other
  discipline-filtered cancels in the pool, so it deserves its own pass
  rather than being bolted on here.

## 5. Count

Library cards supported: **203 → 208 of 444 (46.8%)**. The crypt (217
cards) is untouched until phase 7's importer.
