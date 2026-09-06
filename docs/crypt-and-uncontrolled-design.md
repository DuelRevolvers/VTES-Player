# The crypt and the uncontrolled region

*Chantry (100329), Grooming the Protégé (100860), Wider View (102180),
Family Gathering (102289), Yawp Court (102199).*

**These are the last five buildable Masters** — the other five are Path-
or zombie-BLOCKED — so Master finishes at 5 unsupported, all of them
blocked rather than deferred. And four of the five reach into the two
zones the engine has barely used: **the crypt** and **the uncontrolled
region**.

That is not a coincidence. Those zones are phase 7's territory (the deck
importer), so nothing has needed them; what exists is exactly what the
influence phase required — `SeatState.crypt: MinionState[]`,
`UncontrolledEntry { card, counters }`, `CryptCardDrawn`,
`PoolMovedToUncontrolled`, `UncontrolledBloodAdded`,
`VampireEnteredPlay`. **This wave needed no new zone and no new event
for the crypt half**: every card here is a new way to reach machinery the
influence phase already owns.

## 1. The crypt is ORDERED, and two cards care

`crypt` is an array and `CryptCardDrawn` does `crypt.shift()` — the top
is index 0, the same convention the library uses. Two cards make that
ordering visible for the first time:

- **Family Gathering** — "Reveal the top card of your crypt. If it is a
  Hecata, draw it and add 1 blood to it; otherwise, **move it to the
  bottom** of your crypt."
- **Wider View** — "use 1 transfer to draw 1 card from your crypt".

**`CryptCardBuried`** is the one new event: top → bottom, the crypt twin
of `CardBuried`. Getting the direction backwards is invisible until a
game runs long enough to see the card again, which is the note the
library version already carries.

**Reading on record: Family Gathering is not a choice.** "Reveal the top
card … If it is a Hecata, draw it … otherwise, move it to the bottom" is
an instruction with no "you can" in it, so it resolves without asking —
the Rebel precedent. The *reveal* needs no modelling either: the card
either moves to the uncontrolled region (public) or to the bottom of the
crypt (face down, and the owner may look at their own crypt anyway,
p. 14). **Nothing learns anything it could not already know**, so the
phase-6 "who has looked at this card" gap is untouched.

**A crypt draw goes to the UNCONTROLLED REGION, not to play** (p. 3), and
`CryptCardDrawn` already does that — the reading the bleed-riders wave
recorded for `cryptDrawOnBleedSuccess`.

## 2. Transfers as a currency

Wider View is the first card to **spend transfers on something other
than influence**:

> "You can use **1 transfer** to draw 1 card from your crypt and then
> remove a crypt card in your uncontrolled region from the game. You can
> use **4 transfers** to burn this card and gain 2 pool."

`TurnFrame.transfersLeft` is decremented at three sites in the influence
phase; a card in play spending them needs the same thing from an
ability, so **`EngineOps.spendTransfers(n)`** joins `spendMasterAction()`
— the same shape, for the same reason.

**Both clauses cost transfers, so both are influence-phase abilities**,
gated on `ctx.window === "turn.influence"` and on `ctx.turnSeat` being
the controller (the 2026-08-02 rule: a phase window is offered to more
seats than the phase belongs to).

**Reading on record: the draw and the removal are ONE clause.** "Draw 1
card from your crypt **and then** remove a crypt card in your
uncontrolled region from the game" is a single sentence with a single
cost, so the option is offered only when both halves can happen — the
crypt has a card *and* the uncontrolled region does. The removal names
the card, so it is one option per removable vampire, with the choice in
the option id.

**And the removal is REMOVAL, not burning** (p. 16) — `removeMinionFromGame`
already distinguishes the two fates, built for Golconda: Inner Peace.

## 3. The uncontrolled region as a destination

**Grooming the Protégé** — "Move up to 3 blood from a ready vampire you
control to a **younger vampire of the same clan** in your uncontrolled
region."

Every piece exists: `UncontrolledBloodAdded` (Wasserschloss, Magnetic
Authority), and an `UncontrolledEntry.card` is a full `MinionState`, so
`clan` and `capacityOf` answer the filter directly. The card is one
option per (donor, recipient, amount) — the `x=N` shape.

**Reading on record: "younger" compares the RECIPIENT to the DONOR.**
The sentence moves blood *from* a ready vampire *to* a younger one of the
same clan, so the comparison is between those two, not against anything
else on the table. Derived capacity on both sides, as everywhere.

**Correction on record, found by the first test run: blood put on an
uncontrolled vampire IS its influence counter.** I had assumed the two
were separate and that this card would need a second field. p. 35–36 says
otherwise — influence moves counters one-for-one from the pool onto an
uncontrolled vampire and "they become its blood on taking control" — and
`UncontrolledBloodAdded` has always added to `UncontrolledEntry.counters`
for exactly that reason. So the card needs **no new field at all**, and
the pile it feeds is the same one influence feeds. The engine was right
and the design note was wrong.

## 4. Chantry — torpor to READY, for anybody's Tremere

> "You can lock this card and burn 1 pool **or** 1 blood from a ready
> Tremere you control during your master phase to move a Tremere from
> torpor to **their controller's** ready region."

Three things worth stating:

- **The payment is a choice**, so it is one option per way of paying: the
  pool, or any one ready Tremere with blood. The `paymentSplits` shape.
- **"Their controller's" ready region** — the rescued Tremere may belong
  to another Methuselah, and they go home, not to the Chantry's
  controller. That is `LeftTorpor`, which already returns a minion to its
  own controller's ready region (Warsaw Station).
- **"A Tremere" is any Methuselah's**, which is what makes the card
  interesting and is also the trap: filtering to your own would be a
  silent narrowing.

## 5. Yawp Court — the window between resolution and the referendum

> "If a political action is successful, **before the referendum**, you can
> lock this location and a ready unlocked Sabbat vampire you control to
> have that vampire enter combat with the acting vampire. If the acting
> vampire is still ready at the end of combat, the Sabbat vampire takes 2
> environmental damage and the referendum is conducted as normal."

This is the odd card of the five, and it lands **exactly** on machinery
built two waves apart:

- **`action.afterResolution`** (the after-resolution wave) is the window
  that sits immediately before the action pops, and `finishAction()` —
  which runs when it closes — is where a political action's referendum is
  pushed. "If a political action is successful, before the referendum" is
  therefore that window with `resolvedSuccess === true` and a referendum
  pending, and nothing needed moving.
- **`ActionFrame.queuedCombats`** (the other-vampire-modifiers wave) is a
  combat between two minions *neither of which need be the acting
  minion*, flushed after the action pops. The combat therefore happens
  before the referendum, because `finishAction` flushes the queue and
  then pushes the referendum.
- The 2 damage is an **`AfterCombatRider`** with `source: null` —
  "environmental", which is what `null` has meant since Daring the Dawn.

**Reading on record: "the referendum is conducted as normal" describes
what happens anyway.** The sentence is reassurance to a human reader that
the combat does not cancel the vote; the engine pushes the referendum
from `finishAction` regardless. Reading it as an instruction would be the
"the minion chooses a strike again" trap for the third time.

**Reading on record: the 2 damage is a PRICE, not a penalty for
failure.** It is taken when the acting vampire is *still ready* — i.e.
when the ambush did not work — so a Methuselah who blocks a referendum
successfully pays nothing.

## 6. What this leaves

**Master finishes at 5 unsupported, all BLOCKED** (Burial Site Hunting
Ground, Cursed Abattoir, Forward Momentum, Privileged Position,
Terrifying Visage) — four Path-following and one zombie. Nothing on that
list is a deferral; they are all waiting on an owner decision about scope.
