# The end of the round, and what reopens it

*Hunting the Quarry (102329), Telepathic Tracking (101950), Immortal
Grapple (100959), Target Vitals (101942), Dance with the Devil (102315).*

## 0. The queue entry was WRONG, and that is the headline

`CLAUDE.md` has carried Hunting the Quarry as the expensive Combat entry
for three waves:

> "Only usable if combat is about to end" needs a new combat SUB-STEP, at
> the point the frame would pop. That is a sequencing change, so it wants
> its own design doc and owner review.

**It needs no sub-step.** The combat step order is
`damageResolution → press → endOfRound`, and the **press step is where
`cf.willContinue` is decided**. By the time the `combat.endOfRound`
window opens — a window that already exists, already cycles every seat,
and already hosts Taste of Vitae — the answer to "would this combat end?"
is a finished fact on the frame: `!cf.willContinue && !cf.endedPrematurely`.

So "only usable if combat would end" is a **usable rule**, and "instead,
start a new round" is `cf.willContinue = true`. Nothing sequencing-shaped
happens at all.

**This is the fourth stale cut-list claim in six waves** (Touch of
Valeren, New Carthage, Break the Bonds, now this), and the rule they
teach is the one already written into `partial-support.md`: *a deferral
is a claim about the code as it was.* This one was written during the
combat-attachments wave, before `pressesContinueOnly` and before anybody
had looked at what `endOfRound` already knew. **Check a blocker before
designing against it** — the check took ten minutes and saved a
sequencing change nobody needed.

Having looked, **two more cards want the same window**, which is what
turns one card into a wave.

## 1. The three "would this combat end?" cards

| Card | Clause |
|---|---|
| **Hunting the Quarry** superior | "Only usable if combat **would end**. Instead, this vampire burns 1 blood to start a new round." |
| **Telepathic Tracking** superior | "Only usable if **both combatants are still ready and combat would end**. Instead, start a new round." |
| **Hunting the Quarry** (both) | "Only usable if **both combatants are still ready**." |

Three usable rules, all reading the frame:

- **`onlyIfCombatWouldEnd`** — `!cf.willContinue && !cf.endedPrematurely`.
  The second half matters: a combat that ended *prematurely* (a combatant
  left the ready region, p. 30) reaches End of Round too, and neither
  card can restart that one — Hunting the Quarry says so in as many words
  ("only usable if both combatants are still ready"), and Telepathic
  Tracking repeats it.
- **`onlyIfBothCombatantsReady`** — `combatantReady` on both, the same
  helper the press transition uses.
- **`startNewRound`**, optionally with a blood cost, which is just
  `cf.willContinue = true` before the settle loop reads it.

**Reading on record: "instead" is not a cancel.** The card replaces the
ending, and everything that would have happened at End of Round — riders,
`onCombatEnded` hooks — simply does not happen, because the frame never
pops. Nothing needs undoing, which is the whole reason this is cheap.

Telepathic Tracking's **basic** mode needs nothing new at all: "press,
only usable to continue combat" is `press: { continueOnly: true }`, built
last wave for Righteous Blade, plus a maneuver credit for the next round
if one occurs.

## 2. Immortal Grapple — a restriction on BOTH combatants

```
Grapple. Only usable at close range before strikes are chosen.
A vampire can play only one Immortal Grapple each round.
[pot] Strikes that are not hand strikes cannot be used this round (by
      either combatant).
[POT] As above, with 1 optional press. If another round of combat occurs,
      that round is at close range (skip the determine range step).
```

Everything except the restriction exists: `onlyAtCloseRange`, the
`combat.beforeStrikes` window, `combatLimit: "round"`, `grantPress`, and
the **`grapple` keyword** (built last wave for Sword of the Archangel,
which cancels grapple and aim cards and has been enumerating nothing
because neither existed).

**`CombatFrame.handStrikesOnly` is a ROUND-scoped, BOTH-SIDES flag** — a
single boolean, not the usual `{acting, opposing}` pair, because "by
either combatant" is exactly what makes this card what it is. It is
reset at the round boundary beside `handStrikesAggravated`, and it gates
**options**: a weapon's strike ability, a card-granted strike and the
built-in granted strikes all disappear, leaving the hand strike. That is
the `noPreventBy` precedent — a card that provably cannot be used is not
offered — and it is also what stops the restriction from having to be
enforced a second time at resolution.

**`CombatFrame.skipRangeNextRound`** is the superior's second sentence:
the round-boundary code sets `cf.range = "close"` unconditionally today,
so "that round is at close range" is already true; what the flag adds is
**skipping the determine-range step**, which is the part a maneuver would
otherwise reopen.

## 3. Target Vitals — an AIM, and a cancel paid in cards

```
Aim. Only usable as this minion chooses a strike.
A minion can play only one aim each strike.
If any damage from this strike is successfully inflicted on the opposing
  minion, they take +2 damage from this strike, and they cannot press this
  round. They can discard two combat cards to cancel this card as it is
  played.
```

**"As this minion chooses a strike" is the `combat.chooseStrike` window**,
which already exists and is already where the strike is declared — so an
aim is a combat card whose window is that one, and `onlyAsChoosingStrike`
is the usable rule that keeps it out of every other window.

**"A minion can play only one aim each strike" is a per-KEYWORD limit**,
not a per-card one: `spec.combatLimit` counts by card name, and this
counts by keyword across every aim card. `CombatFrame.aimsThisStrike` is
a list of minion ids, cleared whenever a strike slot is filled or a new
sub-round begins. With one aim card in the pool the distinction cannot
bite today; it is written the way the card prints it because the next aim
card would otherwise be free.

**The damage rider is conditional on the strike LANDING.**
"If any damage from this strike is successfully inflicted … they take +2
damage **from this strike**" — so it is not a strike bonus (which would
apply even if the strike were fully prevented into nothing) and not
separate damage (which would have its own prevention window). It is
`CombatFrame.aimBonus[side]`, added at `pushPendingDamage` **only when
the item's amount is already above zero**, which is precisely
"successfully inflicted".

**The press ban is `cf.restrict[side].press`**, which already exists
(Terror Frenzy sets it), scoped to the round by living on the same reset
line.

**The cancel is pay-to-cancel with a different currency.** The gate was
built for Golconda: Inner Peace (pool) and reused for True Love's Face
(pool, different payer); this one costs **two combat cards from hand**.
`CardPlayFrame.payToCancel` gains `discardCombatCards`, and the built-in
`cancelpay:<cardId>` option is offered only to a payer who actually holds
two — with the pair chosen in the option id, the `combinations()` shape
the pool-drain wave built.

**Reading on record: the cost is NOT refunded.** Target Vitals does not
print "its cost is not paid", and it costs nothing anyway; the rule is
stated so the next pay-to-cancel card does not have to re-derive it.

## 4. Dance with the Devil

```
[obf] or [tha] Maneuver, only usable to get to close range.
[OBF] or [THA] As above, and once this round, this vampire can burn 1
      blood to get 1 additional maneuver, only usable to get to close
      range.
```

The whole card is `closeManeuvers`, built for Angel's Gift in the
play-from-hand wave: a round-scoped credit usable only at long range,
spent before an ordinary maneuver because it is the use-it-or-lose-it
one. The basic **performs** the maneuver; the superior additionally
**grants** one, bought with a blood, once this round.

`"[obf] or [tha]"` is the existing "any one of" mode shape, and "once
this round" is `combatLimit: "round"` on the mode — the per-mode limit
built for Terror Frenzy superior, so the basic stays free.

## 5. What this wave does not do

Nothing is cut. Two things are worth recording:

- **Hunting the Quarry's first clause reuses two built gates and needs no
  third**: `attachInCombat` with `to: "opposing"` (which records a
  `controller`, p. 16 — "you still control this card") and
  `permanent.rushGrant` with `who.scope: "controller"`,
  `target.scope: "bearer"`. The only new field is `rushGrant.burnsCard`,
  because this grant spends the card that offers it.
- **Combat drops to 4**, and what is left there is Dust Up, Taste of
  Vitae, Hunger of Marduk and Anticipation — three of which are ordinary
  and one of which (Anticipation) is the Vozhd of Gravesend's strike
  cancel with a Salubri filter. None is a gate.
