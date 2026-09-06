# Crypt wave 5 — granted actions, and conditions on the other minion

2026-09-03. **Crypt 87/217 supported. 205 of 217 crypt cards play
correctly; 12 ability cards remain.** Total 531/661 (80.3%).

13 cards in three groups. Almost nothing new: every effect was an op that
already existed, and the work was the *shape* around it.

---

## 1. Six granted actions, one clause

Six cards print the same sentence with the verb swapped:

| Card | Does | Cost |
|---|---|---|
| Seraphina | add 2 blood or life to a minion you control | +1 stealth |
| Saankaláxt | steal an equipment | Ⓓ, 1 blood |
| Lenelle | exchange a hand card for a library card in your ash heap | +1 stealth, 1 blood |
| Hel-Blá | move an ally from your ash heap to your ready region, locked | +1 stealth, 1 blood |
| Eulogio | look at and reorder the top 5 of your library, and unlock | +1 stealth, 1 blood |
| Aniel | burn a corruption counter or a Discipline card off another ready minion | +1 stealth, Ⓓ, 1 blood |

`permanent.grantedAction` supplies the shared shape, which is the whole
of the work: **enumerate one option per legal answer, fix it at
announcement (p. 25), pay at resolution (p. 27), and route back through
`resolveGrantedAction` by effect key.** The answer rides in the option
id, so a blocked action spends nothing and changes nothing.

Two things were free and worth noting:

- **The combat-on-success gate opts out by construction.** A
  minion-targeted `cardEffect` normally enters combat with its target,
  and the engine's `rushLike` test already requires the granted effect's
  key to be `"enterCombat"` — so a named key like `cryptGrantedAction`
  never rushes. No `noCombat` flag was needed, unlike the hand-played
  case Mind Numb had to fix.
- **The cost gates the OPTION as well as being paid.** A price the actor
  cannot meet is not a choice, which is the `rescueDiscountFor` lesson
  applied at the cheap end.

**The effect KEY is what routes resolution**, and getting it wrong is
silent: `announceEntryAction` defaults to `"enterCombat"`, so an action
with no key announces, resolves, and does nothing — which is exactly what
happened to wave 2's search. Every card here is therefore **driven to
resolution in its test**, not merely offered.

---

## 2. Reordering a library is not searching it

Eulogio needed the one new op, `moveLibraryCardTo`, and the distinction
it draws is the point:

- A **search** (`searchToHand`) takes a card OUT of the library, so p. 14
  demands a shuffle and the card is named to the table.
- A **reorder** leaves every card where it was. Nothing is revealed, so
  there is **no shuffle** and the `LibraryCardMoved` event deliberately
  **carries no card name** — a log entry naming them would leak what only
  the owner may see. A test asserts both absences.

"Reorder the top 5" is a **repeated ChoiceFrame** — the player names which
card goes next and the frame is re-raised — rather than one option per
permutation. Five cards is 120 orderings, which is a decision nobody can
read; this is the `unlockToll` shape, chosen for the same reason.

---

## 3. "Your corruption counters" as a filter (Faruq, Sergio)

Both cards take a static that already existed and add one condition:
Faruq bars a **combat-ends strike** (`opposingCannotCombatEnds`, Dog
Pack's) and Sergio charges a **block toll** (`blockToll`, Archon's), each
only against a minion the card's controller has corrupted.

`opposingCannotCombatEnds` widened from `boolean` to
`boolean | { yourCorruption: true }` rather than gaining a sibling field.
**Two fields for one idea is how `modifyVotes` and `restrictVotes`
drifted apart** — one is enumerated in two places and only one of them
learns about a new case.

**"YOUR corruption counters" is the CARD's controller**, not the bearer's
— `MinionState.corruption` is keyed by the seat that placed it, and p. 16
makes those two seats different for a card on somebody else's minion.
Both tests pin the wrong-seat case, which is the shape that has bitten
this project four times (Disarm, Puppet Master, Hunting the Quarry,
`controllerOfEntry`).

Sergio's `payWith: "bloodOrLife"` is load-bearing: p. 22 gives allies
life, so a toll printed in blood alone would lock them out of blocking
entirely rather than charging them.

---

## 4. A play-cost modifier aimed at the OPPOSING combatant

Djeneba ("strike cards cost the opposing minion +1 blood or life") and
Algirdas ("…cost opposing younger vampires +1 blood") were both deferred
in wave 3 with the note that `whileBearerEngaged` "asks a nearby but
different question". It does: that flag asks whether the BEARER is
engaged and then charges by `minions`, where these charge *whoever is
fighting the bearer*.

`PlayCostMod.opposingBearer` is that question, **resolved off the live
combat frame on every read**. The rule `docs/retainer-wave-design.md` §1
states, for its stated reason: a combat ends four different ways, and a
flag cleaned up at three of them will one day survive the fourth. A test
deletes the frame and watches the surcharge lift.

---

## 5. Phase hooks that ask a question

- **Mora** — "you CAN move a library card from your ash heap to the
  bottom of your library": an **optional** ChoiceFrame, which is right
  precisely because declining does nothing. (The library-search gate's
  lesson is the converse: an optional frame is WRONG when its decline
  would skip something mandatory, because a decline never calls
  `applyChoice`.) The new op `ashHeapToLibraryBottom` is not
  `takeFromAshHeap`, which puts the card in the HAND; and the library is
  drawn from the FRONT, so "the bottom" is `push` — the `CardBuried`
  rule, which is invisible to get wrong until a game runs long enough to
  draw the card again.
- **Luciano** — one option per (retainer, new bearer) pair, the Garibaldi
  shape, filtered on the printed `animal` tag.
- **Aemilius** — "your prey CHOOSES a ready minion they control". The
  choice belongs to the **prey**, and it is **mandatory** (no "can"), so
  the frame is non-optional and the prey's option list carries no pass.
  "Unpreventable" needs no modelling: prevention lives in combat's damage
  window and there is none here (Daring the Dawn's reading).

All three gate on the **turn seat**, which is the 2026-08-02 bug this
file records: the unlock and discard windows are offered to every
Methuselah, so "during YOUR phase" has to say so. Aemilius's test pins
the wrong-seat case.

---

## 6. Test fixtures that measured the walk, not the gate — three more

Every one of these was the engine being right:

1. **A walker that keeps going after the action resolves plays the
   board.** Eulogio unlocks himself, so the helper's next pass let him
   take a *second* action, which re-locked him and made the unlock look
   broken. `resolve()` now stops the moment no action or choice frame is
   left and never falls through to `options[0]`.
2. **`threeSeatGame()` opens at `turn.minion`** — Alice's unlock phase has
   already happened. An unlock-phase test has to walk a full rotation,
   ending turns rather than taking actions.
3. **A negative test needs a fixture that fails for the RIGHT reason.**
   The Hel-Blá negative first used Carlton Van Wyk, which is not an ally
   in this pool at all — so it would have passed even with no filter.
   Screamer is a real ally that simply requires nothing, which is the
   control the clause deserves. The Faruq control case failed outright
   because the fixture gave the blocker Celerity where Majesty requires
   **Presence**; without that control, the negative test proved nothing.

---

## 7. Left, with reasons (12 cards)

- **Ashur-uballit** — needs a hook at the ally/retainer ENTRY path where
  `life` is computed.
- **Fotini** — "+1 hand size until your NEXT discard phase" is a third
  duration beside the turn-frame and combat-frame grants
  (`docs/temporary-hand-size-design.md`).
- **Elen Kamjian** — a MANDATORY bleed. The mandatory-action machinery
  exists for the 0-blood hunt (p. 21); this is a second instance of it.
- **Ilonka** — looks at a hand and discards at random: Revelations'
  shape, and it lands on the recorded `PlayerView` memory gap.
- **Gathii** — reveals the top card of the library during an action.
- **Alexander Silverson** — a toll on CASTING a vote, the block-tax shape
  one frame over.
- **Cedrick** — the first card wanting both `cancelled` and `forcedFail`,
  plus a hook after a cancelled referendum, which by construction emits
  no `ReferendumResolved`.
- **Evan Klein** — a coin flip as an action is ANNOUNCED; `randomIndex`
  exists, that window does not.
- **Jason Newberry** — needs the vote DIRECTION as a condition axis.
- **Nonu Dis** — "after playing a master card" during your master phase.
- **Parijat, Tommaso** — both about your wraith/zombie allies: a block
  toll paid in LIBRARY CARDS, and a combat ended from outside it.
