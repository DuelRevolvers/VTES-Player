# Crypt wave 7 — the last seven, and the crypt is finished

2026-09-03. **Crypt 99/217 supported. ALL 217 crypt cards play
correctly — 99 with an implementation, 118 whose printed text is a bare
sect/title line. Total 543/661 (82.1%).**

**THE WHOLE V5 POOL IS NOW IMPLEMENTED.** Library 444/444, crypt 217/217.

Seven cards, each needing a mechanism that did not exist. One of them
exposed a hook that had been firing one step too early since it was
written.

---

## 1. THE BUG: `onActionAnnounced` fired before the action existed

Evan Klein — *"as a minion announces an action directed at Evan, flip a
coin; if it is tails, the action fails"* — was written against
`onActionAnnounced`, which lived in `applyToFrames` on the
`ActionAnnounced` event. That placement was deliberate and documented:
*"this is the one point every announce site passes through"*.

**But all three announce sites EMIT the event and only then PUSH the
frame.** So a card acting on the hook saw:

- no `targetMinion` at all — it is on the frame, not the event; and
- no action frame, so `ops.failAction()` found nothing to fail and
  **silently did nothing**.

Its only previous user was **Slaughtering the Herd**, which just emits a
bleed — order-independent, so nothing ever noticed. This is the same
family as the `onBleedSuccess` and `onAnyUnlock` bugs the last two waves
found: *machinery that existed, was documented as general, and quietly
did not apply to one case.*

The fix keeps the chokepoint property it was placed there for.
`notifyActionAnnounced(af)` is called from the three sites that push an
action frame — one helper, three callers, so a fourth announce path
cannot forget the hook without also forgetting to push a frame. The info
now comes off the **frame**, which is where the target lives.

`ActionAnnounced` gained an optional `targetMinion` anyway, because the
event log should carry what the action was aimed at.

**Reading on record:** "directed at HIM" is a **minion** target, narrower
than "directed at you" — a bleed targets a SEAT and so never triggers the
coin. That falls out of `targetMinion` being null rather than needing a
rule (the Szlachta Bodyguard reading). And the coin is **recorded either
way**: a log showing only the tails is one in which a heads is
indistinguishable from the card never having fired.

---

## 2. The second mandatory action in the game

Elen Kamjian — *"if you control a locked minion, Elen must bleed with +1
bleed as a Ⓓ action unless she must hunt"* — is the first card since the
0-blood hunt to use p. 19's rule that **mandatory actions come first**.
`minionPhaseOptions` grew a second gate, below the hunt, because her own
text defers to it ("unless she must hunt").

**The trap, and it is a real rules question: she LOCKS HERSELF at
announcement (p. 25).** So a naive "do you control a locked minion?"
check is true of every bleed she ever makes, and the condition is no
condition at all. The bonus therefore never counts *her* — and the gate
in `minionPhaseOptions` agrees by construction, since it reads the board
before she locks.

The compulsion and the bonus are **one sentence**, so both read the same
condition; a bonus that applied while she was free would be inventing
text. A test pins 2 while compelled and 1 while free.

---

## 3. "After playing a master card" needs no bookkeeping

Nonu Dis's window is opened by an event that has already happened, so it
is a **read of the event log** from the last `TurnBegan` — the Week of
Nightmares lesson in a fourth place. Nothing is stored, nothing is
cleared, and the window closes on its own when the turn does.

---

## 4. A gamble, not a choice

Gathii reveals the top card of his own library, and the OPTION
deliberately does not say what it is. Knowing would make it a choice
rather than a gamble, and the top of your own library is not something
you may read (p. 14). A test asserts the label does not name the card.

The reveal is **named to the table** — that is exactly what revealing
means, and it is the opposite of wave 5's `LibraryCardMoved`, which
carries no name because a reorder shows nobody anything.

He must be able to pay the penalty for the option to be offered: a card
that could lose is still a card that must be able to settle up.

---

## 5. Looking at a hand you may not read

Ilonka looks at the bleeder's hand and then discards one **at random**.
The hand reaches only her controller, because a `ChoiceFrame` is
addressed to one Methuselah — the Revelations precedent — and the option
list carries **one** entry, because the discard is random and offering a
choice of card would be a lie about what the card does.

The frame is **optional** ("she CAN look … then she CAN discard"), which
is right precisely because declining does nothing. The library-search
gate's lesson is the converse: an optional frame is *wrong* when its
decline would skip something mandatory, since a decline never calls
`applyChoice`.

---

## 6. A block toll in a third currency

Parijat: *"while Parijat is ready, minions must burn the top card of
their library to attempt to block wraith or zombie allies."*

Two things make this unlike `PermanentStatics.blockToll` (Archon,
Sergio), which rides on the minion **being blocked**:

- it is radiated **at the whole table**, so it is found by scanning ready
  minions rather than by reading the actor's attachments; and
- it is keyed on **who is acting**, not on who is being blocked.

`libraryBlockToll` is that scan, derived on every read — "while Parijat
is ready" stops holding the moment he goes to torpor. The block-tax
gate's own rule carries over unchanged: **a toll that cannot be paid is a
block that cannot be attempted**, so a blocker with an empty library is
not offered the block at all. The burnt card goes to its owner's ash heap
(p. 16).

Both control cases matter, and both are pinned: no Parijat means no toll,
and blocking an ordinary **vampire** while Parijat is in play costs
nothing.

---

## 7. Ending a combat you are not in

Tommaso extends the existing `combatEndGrant` (Garibaldi's) with four
fields rather than getting a clause of its own: a **tag list** on one own
combatant (`ownMinionTags` — "a wraith OR zombie ally" is the union
reading, again), a **blood cost paid instead of locking**, a
once-per-turn limit, and a requirement that the bearer be ready.

**The blood is paid INSTEAD of locking, not as well.** The card names one
price, and locking a vampire is not something its text asks for — a test
asserts he is still unlocked afterwards.

---

## 8. Fixture traps, and the seventh instance of one

- **Playing an action card pushes a CARD-PLAY frame first.** The action is
  not announced until its as-played window closes, so a helper that
  stopped at "no action frame" returned before the action existed. That
  is what made the Evan Klein tests look like an engine bug when the
  engine was, for once, only half wrong.
- **`threeSeatGame()` opens at `turn.minion`**, so reaching a master
  phase crosses a full rotation — and checking the *phase* without the
  *seat* stops at another Methuselah's, where your card is not playable
  and the option list is bare.
- **A vampire at 0 blood MUST hunt (p. 21), and the walker will feed
  him.** Tommaso's "cannot pay" test measured the walk until he was
  locked instead. That is the **seventh** time this has come up; the rule
  is simply that a fixture setting blood to 0 has also enabled a
  mandatory action.
- **A combat frame outlives the ability that ends it** — End of Round
  still runs (p. 30/p. 32), so a test must walk it out rather than assert
  immediately.
