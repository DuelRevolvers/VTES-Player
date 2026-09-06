# Rush actions and what happens after the combat

*Abuse of Power (102309), Pillars Fall (102333), Hunting the Beast
(102356), Hunter's Mark (102228), Make the Misere (101147).*

## 1. The cluster

A survey of the 27 unsupported Action cards found the largest coherent
family: **"Ⓓ Enter combat with \<X\>"** played from hand, where the card
does not merely start a fight — it attaches something to the fight, or
collects a payoff once the fight is over.

| Card | What it adds to the rush |
|---|---|
| Abuse of Power | *after*: "if only one combatant is ready, the controller of the opposing minion burns 1 pool" |
| Pillars Fall | *after*: "if the opposing vampire is not ready, you can put this card on this acting vampire" (+1 bleed) |
| Hunting the Beast `[AUS]` | *after*: "if this vampire is ready and the opposing vampire is not, add 2 blood to a Salubri in your uncontrolled region" |
| Hunter's Mark | *during*: 1 optional press; `[CEL][THA]` also "the opposing minion cannot strike: combat ends during the first round" |
| Make the Misere | *during*: maneuver / stealth / strength, **one rider per Discipline the actor has** |

Half the kernel already exists. `docs/rush-actions-design.md` built the
rush itself (target fixed at announcement, directedness derived from the
target's controller, combat pushed in `finishAction` after the action
frame pops, `af.rushRiders` for "during that combat" credits), and
`docs/after-combat-ends-design.md` built `CombatFrame.afterCombatEnds`,
applied **after the frame pops** so a rider may raise a ChoiceFrame
without the combat's own `pop()` eating it.

What is missing is the join: **a rider that an ACTION installs on the
combat it starts, and that reads who is still standing when it ends.**

## 2. One rider kind, not three

The three "after" cards differ in their condition and in their payoff, but
they are the same shape, so `AfterCombatRider` gains a single variant
carrying both halves rather than three parallel ones:

```ts
| {
    kind: "outcome";
    /** The ACTING minion, so "the opposing minion" is relative to them —
     *  a rush's actor is always `cf.acting`, but reading it off the
     *  rider keeps the condition legible where it is applied. */
    actor: MinionId;
    seat: SeatId;
    when: "oneCombatantReady" | "opposingNotReady" | "actorReadyOpposingNot";
    effect:
      | { kind: "burnOpposingControllerPool"; amount: number }
      | { kind: "attachToActor"; cardId; name; statics; tags }
      | { kind: "bloodToUncontrolled"; amount: number; clan?: string };
  }
```

**"Ready" is asked with `findMinion`, never `getMinion`.** A combatant can
be burned during the combat that these cards are about — that is precisely
the case they are written for — so a minion that has left play answers
"not ready" instead of throwing. That is the standing rule recorded in
CLAUDE.md for reading combatants, and here it is the common case rather
than the edge case.

`ActionFrame.combatOutcome` carries the rider from announcement to
`finishAction`, which hands it to `pushCombat` alongside `af.rushRiders`.
It is installed **only on the rush's own combat**: a rush that is
*blocked* fights the blocker, and the card says "that combat", meaning the
one it announced. That is the same reading `rushRiders` already takes
(rush design §2.4).

## 3. Abuse of Power reads literally

> "At the end of that combat, if only one combatant is ready, the
> controller of the opposing minion burns 1 pool."

Two things worth stating, because both are tempting to "fix":

- The condition is **exactly one** of the two ready, not "the opponent is
  down". If the acting vampire is the one who fell and the opponent
  survived, the condition still holds and the opponent's controller still
  burns a pool. The card names no exception and the symmetry is plainly
  deliberate — it is a 0-cost, no-Discipline rush.
- "The opposing minion" is opposing **the actor**, so the pool comes from
  the other combatant's controller either way.

## 4. "You can" is a choice, not an auto-take

Pillars Fall says *"you **can** put this card on this acting vampire"* and
Hunting the Beast picks *"a Salubri in your uncontrolled region"*. Both
are raised as **ChoiceFrames**, following the direction the owner endorsed
when Cave of Apples' and Dead Pool's optional riders were converted from
auto-taken to real choices.

This deliberately does **not** follow the Show of Force reading (a
costless beneficial rider applied unconditionally), which CLAUDE.md
already flags for owner review. The difference that decides it: Show of
Force's bonus vanishes with the combat, while these two put a permanent
into play or move blood — durable board changes a player may not want
(Pillars Fall's card can then be seen, and "a vampire can have only one
Pillars Fall" makes where it lands matter).

Hunting the Beast follows the **Brujah Debate precedent**: automatic when
there is exactly one legal recipient, a ChoiceFrame when there are
several. With none, nothing happens and no frame is raised — an empty
option list pops harmlessly, but not raising it at all is cheaper and
reads better in the log.

## 5. Hunter's Mark: a rush rider that is a prohibition

> `[CEL][THA]` "…and the opposing minion cannot strike: combat ends during
> the first round of that combat."

`PermanentStatics.opposingCannotCombatEnds` already expresses this from a
card in play (Dog Pack), read in the `combat.chooseStrike` enumeration.
The rush wants the same prohibition scoped to a combat and a round, so
`CombatFrame.noCombatEndsFirstRound` sits beside it and is checked in the
same branch — a gate on OPTIONS, so the strike is never offered rather
than being offered and refused.

`rushRiders` widened from `{ maneuver, press }` to carry it, plus
`strength` for Make the Misere. Every field is applied at `pushCombat`
into the frame slot that already owns it (`maneuverCredits`,
`pressesCombat`, `strengthBonus`), so nothing new has to be spent or
reset.

## 6. "More than one Discipline can be used to play this card"

Three cards in the V5 pool print this line: The Platinum Protocol
(supported, as a **hand-rolled handler**), Make the Misere, and Break the
Bonds. It is a genuinely different shape from everything in the mode
vocabulary: **modes are exclusive — pick one — and these are additive.**

`CardSpec.multiDiscipline: true` says so. For such a spec:

- **Enumeration** emits one option per (minion, target) with no mode
  segment to choose — the actor's Disciplines already determine which
  riders apply, so offering a choice would offer a lie.
- **Resolution** applies every mode whose Discipline the actor has, plus
  every mode with `discipline: null` (the card's unconditional clause —
  the rush itself, or the bleed).
- The **affordability and requirement gates** run once, on the card, not
  per mode: there is nothing to choose between.

This is why the pattern was hand-rolled the first time. With the spec flag
it is data, and The Platinum Protocol's bespoke handler could be retired
to a spec — deliberately **not** done in this wave: it is supported and
green, and rewriting a working card is a separate, checkable change.
Break the Bonds (a bleed with three additive riders) is the remaining
card of this shape and should be the next Action wave's cheapest entry.

## 7. Rulebook citations

- p. 20 — "(limited)" bonuses; a +1 stealth action's inherent stealth.
- p. 25 — action details, including targets, are fixed at announcement;
  blocking locks the blocker, and the rush target does not lock.
- p. 27 — an action is successful only if it is not blocked; a blocked
  action's card effects do not resolve.
- p. 30 — a combat ends immediately when a combatant is no longer ready.
- p. 32 — the End of Round step still occurs when a combat ends early.

## 8. Readings on record

1. **Abuse of Power fires when either combatant is the only one left**
   (§3) — a literal reading of "only one combatant is ready".
2. **A rush's outcome rider belongs to the rush's own combat**, not to the
   combat a blocker forces. "That combat" is the one the card announced.
3. **The optional riders are ChoiceFrames** (§4), not auto-taken, and this
   diverges from Show of Force on purpose.
4. **Make the Misere's `[obf]` mode gives the action +1 stealth even
   though the printed line is a sentence rather than a bonus** — "This is
   a +1 stealth action" is the card's inherent stealth (p. 20), applied at
   announcement like every other `actionStealth`, and conditioned only on
   the actor having Obfuscate.
