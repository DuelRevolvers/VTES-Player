# The cheap tail

*Garibaldi-Meucci Museum (100809), Vagabond Mystic (102087), Underbridge
Stray (102065), Voracious Vermin (102266), Heart of Nizchetus (100903),
True Love's Face (102041).*

**Six cards chosen by the ledger rather than by a mechanism.** Every one
of them has a row in `docs/partial-support.md`'s cut list saying, in so
many words, that it is one clause away — and several of those rows were
written *before* the clause they wanted was built. This wave clears them
and leaves the cut list holding only cards that are genuinely expensive
(Hunting the Quarry's combat sub-step, Deep Song's role inversion,
Go-getter's re-opened action, Spying Mission's window, Stolen Police
Cruiser's derived intercept static, the two token-vampire cards) plus the
BLOCKED wraith/zombie/Path set.

That is the point of keeping the ledger: **a survey that reads it takes
minutes and a survey that re-derives it takes hours**, and twice now
(Touch of Valeren, New Carthage) a stale row sent me designing against a
blocker that no longer existed. Two of the six here are the same story —
their rows named pieces that landed in the last three waves.

## 1. Garibaldi-Meucci Museum — two clauses, both already built

```
Unique location.
You can lock this location and burn 1 pool during your unlock phase to
  exchange one card from your hand for one card in your ash heap
  requiring an Anarch.
You can lock this location before range is determined to end a combat
  involving an Anarch you control and another Anarch.
```

Its cut row said "needs only the new `requiresSects` central query plus
`takeFromAshHeap`; its second clause is `endCombatFromOutside`" — and all
three were built by the ash-heap wave. So this is `permanent.ashExchange`
and `permanent.combatEndGrant`, two small clauses on the master
compiler's existing ability plumbing.

**The exchange was enumerated as one option per (hand card, ash-heap
card) pair**, with both ids in the option id — the shape the play-cost
wave's `paymentSplits` and the pool-drain wave's `combinations()` already
use. The reasoning written here was that it is a single decision in the
card's own text ("exchange **one** card **for one** card"), so splitting
it into two ChoiceFrames would invent a sequencing the card does not have.

### That was replaced with two pickers on 2026-09-21 (owner request)

The pair enumeration is a true reading of the card and an unreadable
menu. A seven-card hand and four Anarch-requiring cards in the heap put
**twenty-eight** lines of "swap X for Y" on one card, all alike, all
differing in two names buried mid-sentence — and the player's actual
question ("what can I get back?") is not asked anywhere in it. **It is now
one option on the card — "exchange a card with your ash heap" — followed
by two card pickers: the ash heap first, then the hand.**

- **The sequencing it "invents" is unobservable**, which is why the
  original objection does not survive contact. A ChoiceFrame has no
  impulse cycle, asks nobody else anything, and is answered before
  anything else moves (`choice-frames-design.md` §3). Between activating
  the museum and naming both cards, no other seat has a decision and no
  zone can change. The decision is still atomic *in the game*; only the
  question is asked in two parts.
- **The pickers are free.** The engine backfills `answerChoice.card` from
  any param naming a card, and the table draws a grid of card images for
  any decision whose answers name cards (`render.ts`, the `picks` branch).
  So the ash heap is *read* rather than skimmed as prose, which is the one
  thing a physical table never makes you do.
- **The take rides on the FRAME, not on the give option.** The backfill
  takes the first param that resolves to a card, so an option carrying
  both ids would picture the wrong card — the second picker would show the
  first picker's answer. Each option's params name only the card that
  option picks. Asserted in the test.
- **The cost is paid on ACTIVATION and neither picker can be declined.**
  "You can lock this location and burn 1 pool **to** exchange…" makes the
  lock and the pool the price of asking. That moves a futile-options
  burden onto the gate: the option is offered only when the hand is
  non-empty **and** something in the heap qualifies, or a player could
  burn a pool for nothing. Both are asserted as negative space.
- **`ashExchangeTargets` is the one filter**, read by the gate and by the
  picker. Two copies would drift the day the sect list gained an entry,
  and the failure would be an empty picker after a paid cost.
- **The granted-action twin keeps the pair list, and must.** Lenelle,
  Mambo of Birmingham (201721) grants the same exchange **as an action**,
  and an action's params are fixed at announcement (p. 25) — before the
  impulse cycle her opponents get. Her menu cannot become a choice frame
  without changing when the cards are named, so the ugly shape is the
  correct one there. Her list is the bigger one, too: she filters the heap
  by nothing at all.

**One thing measured and left alone.** The AI's `scoreChoice` has a branch
for "any choice that names one of my cards: shed the most redundant one"
(`ai-answer-choice-design.md`). The give picker lands in it and is scored
correctly for free. The take picker lands in it as well, where "the card I
built the most copies of" is an unvalidated proxy for "the card I want
back" — the same term, a different question. It was not changed, because
the alternative is an unmeasured policy edit to a function four rounds of
measurement deep; it is a candidate for the next AI pass, not a fix to
smuggle into a UX change.

**Which cards qualify is `CardHandler.requiresSects`**, added centrally in
`compileSpec` during the ash-heap wave for exactly this card and unused
until now. A hand-rolled handler answers `undefined` there, which
`backfillCentralQueries` covers.

**Reading on record: both combatants must be Anarchs and one must be
yours.** "A combat involving an Anarch you control **and another
Anarch**" names two, and the second is "another", so a combat between
your Anarch and a non-Anarch is not endable. The location's controller
need not be in the combat at all — this is the `endCombatFromOutside`
path, built for Saulot's Guiding Wisdom.

## 2. Vagabond Mystic — "cannot block vampires"

Its row named the one missing piece: `PermanentStatics.cannotBlock` is
unconditional, and this card's restriction is keyed on **what is
acting**. `cannotBlockKind?: "vampire" | "ally"` is one filter added
beside it in `blockOptions`, where `cannotBlock` is already read.

The heal half — "lock to add 1 life to an ally you control who has fewer
life than its starting life" — needs nothing new:
`allyAbilities.lockToHealAlly`, and "starting life" is `capacityOf`,
which an ally's `capacity` field has held since the outside-combat wave
established that it is a reference rather than a cap (p. 11).

**Negative space worth pinning:** the Mystic may still block an ALLY, and
may still be *blocked* by anything. "Cannot block vampires" restricts one
direction only.

## 3. Underbridge Stray — a reaction that spends the ally itself

```
[ani] This ally can burn 1 life to give a minion you control 1 press.
      During an action directed at you (or a card you control), you can
      burn this ally if it is not blocking to unlock a ready minion you
      control.
[ANI] As above, but this ally has 2 life and 1 strength.
```

Two `allyAbilities` clauses. The press half is
`grantCombatPressToMinion`, built in the combat-attachments wave for the
three mid-combat grants a card in play can hand its bearer.

The second is the interesting one, and its row named the blocker
precisely: **"if it is not blocking"**. The ally is being spent *instead
of* blocking, so the clause bars it while it is the live block attempt's
blocker — `ctx.blockAttempt?.blocker !== me.id`. Everything else is
existing: the window is the ordinary reaction window (`action.effects`,
state A), the gate is `af.directed && af.target === owner.seat`, and the
payoff is a `MinionUnlocked` on a ready minion of the controller's.

**Reading on record: "(or a card you control)" adds nothing to model
today.** An action directed at a card in play — the granted-action
family's `targetPermanent` — is already *directed at that card's
controller* (p. 25), which is what `af.target` records. So the
parenthetical is the rulebook's own clarification of a case the engine
already funnels through one field, not a second condition.

The two modes differ only in printed stats, which `CardMode.ally` has
expressed since Freakish Conglomeration.

## 4. Voracious Vermin — a GRANTED strike, not a free one

```
[ani] Strike: dodge.
[ANI] As above, with 1 additional ranged strike: burn weapon.
```

Its row said "nothing new — `Strike.burnEquipment`, built for Heroic
Might". That is half right, and the other half is the design decision.

`grantAdditionalStrike` gives an extra sub-round in which the minion
chooses a strike **freely**. Wind Dance is already a recorded deviation
for exactly this ("the superior's additional strike is nominally forced
to a dodge; modelled as a free-choice additional strike"), and taking the
same shortcut here would be worse than a deviation: **the extra strike
would be a hand strike**, because nothing would ever offer "burn weapon"
in that sub-round. The card would be supported and its whole superior
mode inert.

So the strike is **granted, in the shape `grantedCombatEnds` already
uses**: `CombatFrame.grantedBurnEquipment[side]`, set by the card and
read by the `chooseStrike` enumeration beside `strike:combatEnds`, with
one option per equipment card on the opposing minion (the choice rides in
the option id, as Heroic Might's does). One use, cleared when taken.

**Reading on record: with nothing to burn, the granted strike is not
offered** — the same call Heroic Might's `Strike.burnEquipment` already
takes. The additional sub-round still happens; the striker takes a hand
strike or a dodge in it like anyone else.

**This does not retire the Wind Dance row.** A forced *dodge* is a
different shape (a strike the minion must take, not one they may take),
and Wind Dance is supported and green.

## 5. Heart of Nizchetus — draw without discarding, then bury

```
Unique. [Equipment, 1 pool]
If the bearer is ready during your unlock phase, you can draw up to 3
  cards without discarding and then move the same number of cards from
  your hand to the bottom of your library.
```

Its row said "wants a count choice plus N successive bury choices, which
`choiceByKey` now makes safe to add". That is exactly what it gets.

- **"Up to 3"** is one option per count (0–3, capped by the library), the
  `x=N` shape — chosen when the ability is used, so it is in the option
  id rather than a ChoiceFrame.
- **"Without discarding"** needs no modelling at all: `reconcileHandSize`
  only ever draws *up*. Nothing in the engine discards down for being
  over hand size outside the discard phase, which is what the phrase is
  guarding against at a physical table.
- **"Then move the same number to the bottom"** is N successive
  ChoiceFrames, re-raised one at a time — the `targetDiscard` shape, for
  the same reason: each option list must be computed against the hand the
  previous answer left.

New op **`EngineOps.buryInLibrary(seat, cardId)`** and event
`CardBuried`. The library is drawn from the FRONT (`shift`), so "the
bottom" is `push` — worth stating, because getting it backwards is
invisible until a game runs long enough to draw the card again.

**Reading on record: the bury is mandatory once the draw is taken.** The
card says "draw up to 3 … **and then** move the same number", one
sentence, one ability. Choosing 0 is how you decline.

## 6. True Love's Face — pay-to-cancel, from the other end

```
[obf][pre] Only usable during a bleed action. +1 bleed (limited).
[OBF][PRE] Only usable if a minion attempts to block. That attempt fails
  and the blocking minion cannot attempt to block this action again. The
  blocking minion's controller can burn 1 pool to cancel this card as it
  is played.
```

Its row was already marked **"Unblocked now: the pay-to-cancel gate was
built for Golconda: Inner Peace"**, and that is the whole card. The
superior's first two sentences are `failBlockAttempt`, built for the
fail-block cluster, which already writes the blocker into
`af.blockRestrictions.cannotBlock` — "cannot attempt to block this action
again" in as many words.

**The payer is computed from the STATE, not from the option's params.**
Golconda's `payToCancelFor` reads `params.target` because a master's
attach target is a choice made in the option. Here the payer is "the
blocking minion's controller", which is a fact about the live
`BlockAttemptFrame` — so `spec.payToCancel: { pool, who: "blocker" }`
compiles to a `payToCancelFor` that finds that frame. Both answers are
computed at PUSH time, which is the point of the hook: who may pay
depends on what this particular play is doing.

**Consistency on record: the cost is NOT refunded** when the cancel is
bought. Sudden Reversal prints "its cost is not paid" and True Love's
Face does not, which is the same distinction Golconda settled.

## 7. What this wave does not do

Nothing is cut. The two ledger rows it deliberately leaves standing are
the **Wind Dance** forced-dodge deviation (§4) and the structural
`permanent.lockGrant` retrofit recorded by the Vozhd wave — neither is a
card, and neither is what any of these six needed.
