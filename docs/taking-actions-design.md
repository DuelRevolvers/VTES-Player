# Actions that take what belongs to another Methuselah

*Far Mastery (100703), Graverobbing (100852), Puppet Master (101215),
Slaughtering the Herd (101801), Break the Bonds (102247).*

## 1. What the Action survey actually found — read this first

Action was the largest unsupported family (16). Sorting the sixteen by
what they need produced a result worth the owner's attention before any
card was written:

**Seven of the sixteen need the ASH HEAP**, which CLAUDE.md lists as
BLOCKED pending owner review:

| Card | id | What it wants from the ash heap |
|---|---|---|
| Psychophagia | 102302 | remove an ally in **any** Methuselah's ash heap from the game |
| Putrescent Sustenance | 102335 | remove an ally in an ash heap from the game |
| Shroud of Decay `[OBL]` | 102295 | remove 7 cards in your prey's ash heap from the game |
| The Gate of Acheron | 102290 | remove a library card at random from their ash heap |
| Split the Veil | 102297 | move a wraith/zombie ally **from** your ash heap to play |
| Waters of Duat | 102159 | search library, hand **and/or ash heap** |
| Childe of the Revolution | 102246 | same search |

Two of those (Split the Veil, Dance of the Dead) are double-blocked on
wraith/zombie allies as well. **So the ash heap is now the single largest
blocker in the pool**, and it is no longer only "a zone we have not
needed". Flagged, not built — the standing instruction is that BLOCKED
items get owner review first.

Note also that Shroud of Decay's **basic** mode is clean (bleed +1, target
discards 2), so it is a candidate for a partial-support entry if the owner
would rather ship half of it. Not done unilaterally, for the same reason.

That leaves nine. This wave takes the five that form one shape.

## 2. The cluster

**A Ⓓ action whose whole point is that something moves from an opponent to
you.** The control-change gate built the ops years of waves ago; what is
new is what each card takes and how long it keeps it.

| Card | What moves | For how long |
|---|---|---|
| Far Mastery `[dom]`/`[DOM]` | a **retainer**, or an **ally** | permanently |
| Graverobbing `[dom]`/`[DOM]` | a **vampire in torpor** | permanently |
| Puppet Master `[DOM]` | a younger vampire | **until the end of your turn** |
| Slaughtering the Herd `[DOM]` | 1 blood per action they announce | while the card is attached |
| Break the Bonds | a lock on their minion; blood to your uncontrolled | one-shot |

## 3. Temporary control — the one genuinely new mechanic

> Puppet Master `[DOM]`: "…burn this card to unlock the attached vampire
> and **take control of them until the end of your turn**."

Every control change so far has been permanent (`changeMinionControl`,
Powerbase: Montreal, Cave of Apples). This one reverts.

**`MinionState.controlRevertsTo: SeatId`**, set when control is taken and
honoured in **`endTurn`** — which is already the place "cannot act this
turn" expires, so the sweep has a home and a precedent. It is one field
rather than a queue of scheduled effects because the rulebook gives the
lending no other duration: every card in the pool that borrows a minion
says "until the end of your turn".

**Reading on record: everything on the minion travels both ways.** p. 16
is explicit that control of a minion carries its cards, and
`changeMinionControl` already moves the whole `MinionState`. The revert is
the same op in the other direction, so a retainer employed *while
borrowed* goes home with the vampire. That is a consequence worth
knowing rather than a decision — the card says nothing, and inventing an
exception would be inventing text.

## 4. Stealing a retainer vs stealing an ally — two different zones

Far Mastery's two modes look symmetrical and are not:

- a **retainer** is a `PermanentInPlay` attached to a minion, so it moves
  with **`moveAttachment(cardId, to, controller)`** — built for the
  granted-rush wave's equipment move;
- an **ally** is a **`MinionState`** in its controller's `minions` array,
  so it moves with **`changeMinionControl`**.

Nothing new; the point is that "steal a retainer" and "steal an ally" are
not one primitive, and a spec vocabulary that pretended they were would be
wrong about the zone.

**Reading on record: Far Mastery's inferior says "controlled by another
VAMPIRE", not another Methuselah** — so a retainer on your *own* other
vampire is a legal target, and the superior's "controlled by another
Methuselah" is a real narrowing. The two modes are enumerated separately
because of it.

## 5. Graverobbing: control and location are separate questions

> `[dom]`: "Ⓓ Steal a vampire in torpor controlled by another Methuselah."
> `[DOM]`: "As above, and this acting vampire can burn 2 blood to move the
> stolen vampire to your ready region."

The inferior changes **control** and leaves the vampire in torpor; the
superior optionally also changes **where they are**. Those are two
different pieces of state (`controller` and `inTorpor`), and the existing
`LeftTorpor` event does the second. The 2 blood is a real cost and the
move is optional, so the superior emits one option per choice at
announcement rather than deciding for the player.

## 6. Slaughtering the Herd: a siphon on the announce chokepoint

> `[DOM]`: "Put this card on a vampire controlled by your predator. Each
> time the attached vampire announces an action, they move 1 blood from
> themselves to this acting vampire. The attached vampire can burn 4 blood
> during their minion phase to burn this card. Burn this card after this
> acting vampire leaves the ready region."

Three clauses, two of which are already built:

- the buy-off is **`permanent.bearerCanBurn`**, built last wave for
  Disarm — the second user, which is what a primitive wants;
- "burn this card after **this acting vampire** leaves the ready region"
  is `onLeaveReady`, but keyed on a minion that is **not the bearer** —
  the card is on the predator's vampire and dies with the *player's*
  vampire. So the entry has to remember whose card it is:
  **`PermanentInPlay.linkedMinion`**.

The siphon itself goes on **`applyToFrames`'s `ActionAnnounced` branch**,
the single chokepoint `minionActionsThisPhase` and `stealthCharges`
already use, for exactly the reason recorded there: a fourth announce site
cannot forget it. New hook **`onActionAnnounced`**.

**Reading on record: the blood moves, it is not burned.** "Move 1 blood
from themselves to this acting vampire" — so a `BloodBurned` on the bearer
and a `BloodGained` on the linked minion, clamped by the receiver's
capacity like every other gain (p. 11). If the linked vampire is gone the
card is already burnt, so the case does not arise.

## 7. Break the Bonds: the third and last `multiDiscipline` card

`CardSpec.multiDiscipline` collapses "more than one Discipline can be used
to play this card" into one synthetic combined mode built from the actor's
own Disciplines (`combinedMode`), because these clauses are **additive**
where modes are normally exclusive. It was built for Make the Misere and
predicted to have exactly one more user; this is it, and it needed no
change.

Its three riders are all existing primitives: `modifyBleed`,
`onBleedSuccess` + a lock, and `addUncontrolledBlood`.

## 8. Rulebook citations

- p. 11 — a vampire cannot hold more blood than its capacity.
- p. 16 — control vs ownership; **everything on a minion travels with
  control of it**.
- p. 20 — "+N stealth action".
- p. 22 — allies are minions and hold life, not blood.
- p. 23 — one bleed per minion per turn.
- p. 25 — action details, including targets, are fixed at announcement.
- p. 27 — an action card's effects happen only on success.
- p. 36 — a vampire moving to the ready region.

## 9. Readings on record

1. **A borrowed minion goes home with everything on it** (§3) — p. 16,
   and the same op in reverse.
2. **Far Mastery's inferior can take a retainer from your own vampire**
   (§4) — "another vampire", not "another Methuselah".
3. **Graverobbing's move to the ready region is optional and costs 2
   blood** (§5) — one option per choice, fixed at announcement.
4. **Slaughtering the Herd MOVES blood rather than burning it** (§6).
