# Searching the library, and out-of-play card stores

*Magic of the Smith (101143), Vast Wealth (102092), Heart of Nizchetus
(100903), Black Market Cache (102351), Shilmulo Tarot (101767), Fleshforge
Chamber (102354).*

## 1. Why this is a gate and not a sweep

Until now **no card has looked at the library at all.** It is an ordered
`CardInstance[]` that only ever loses its top card to `drawToReplace`, and
`PlayerView` models it as a *count* — "you may not read your own deck".
Six cards want to reach into it, and three of them want a place to put
cards that is neither hand, library, nor play.

Two mechanisms, one gate, because Black Market Cache needs both:

- **Searching** — Magic of the Smith, Vast Wealth, Black Market Cache.
- **An out-of-play store on a card** — Black Market Cache, Shilmulo Tarot,
  Fleshforge Chamber.

Heart of Nizchetus rides along: it is pure library manipulation (draw
without discarding, then bury the same number), no search and no store.

## 2. The rulebook is unusually explicit here, and it overrides the defaults

p. 14, "Search":

> Some effects have you search your library or crypt. **You do not have to
> announce the card you are searching**, and **searching can result in not
> finding the card**. If you search your library or crypt, **you must
> shuffle it afterwards**.

and the card-specific ruling for Magic of the Smith, p. 48:

> You do not have to announce which card you are getting when playing the
> card. **You do not search your library until the action is successful.**
> The equipment card must come from your library, though **you are free
> not to find any**. […] you may choose not to find anything, even though
> there are other equipment cards in your library (**you still shuffle the
> library**).

Three consequences, all of which cut against this engine's usual habits:

1. **The search is NOT resolved at announcement.** Every other action
   target in this engine is fixed at announcement and rides in the option
   id (p. 25). A search is the documented exception: the card is chosen at
   *resolution*, and the text says so twice.
2. **"Find nothing" is always a legal answer** — even when matching cards
   exist. So the choice is never auto-taken and never skipped.
3. **The shuffle happens either way**, including when nothing was found.

So a search is a **`ChoiceFrame` raised at resolution**, not option-id
params. That is a rules-driven decision; it also happens to be the only
shape that keeps the searched cards out of the option ids of the
*announcing* play, which the next section cares about.

## 3. Hidden information: the option list is the search

A search shows the searcher their own library. Nobody else may see it.

- The candidate cards appear **only** in the option list of a `ChoiceFrame`
  addressed to the searching seat, and a decision point is only ever
  handed to one seat.
- The **event log records only what was taken**, never what was seen. A
  card that is equipped or put face up becomes public anyway; a card that
  was looked at and left in the library must not.
- `redactFor` is still the one masking rule: `library` stays face-down for
  everyone including its owner, and this wave adds face-down **stores**
  (§5) to it.

**Not fixed by this wave, and still on the phase-6 list:** "who has looked
at this card". A searcher legitimately learns their own deck's contents;
that knowledge lives in the player's head, not in the state, and no card
here reveals another player's cards. Nothing is wrong today, and the gap
is unchanged.

## 4. Searching, and the deterministic variant

`ops.searchLibrary(seat, filter, key)` raises the choice; `applyChoice`
takes the answer. Filters are data: `cardTypes` (via the `costTypes`
query), `nonUniqueOnly`, and a count for "up to three".

**Vast Wealth is deliberately not a choice.** "The **first** equipment you
find in your library (**working down from the top**)" names the card by
position, so there is nothing to ask: the engine walks the library and
takes the first match, or nothing. It still shuffles. This is the one
search in the pool with no ChoiceFrame, and it is that way because the
card removed the choice, not because the engine skipped it.

## 5. The out-of-play store — `PermanentInPlay.stored`

```ts
/** Cards moved out of play onto this card (Black Market Cache, Shilmulo
 *  Tarot, Fleshforge Chamber). Not hand, not library, not in play. */
stored?: CardInstance[];
/** Face up (public) or face down (owner may look — p. 14). */
storedFaceUp?: boolean;
```

Three cards fill it from three different places — the library (Black
Market Cache's search, Shilmulo Tarot's top card), and the hand
(Fleshforge Chamber) — and two of them drain it in the same way (§6).

`storedFaceUp: false` is masked in `redactFor` for every seat but the
owner. That required extending redaction to **attached** permanents, which
it had never touched: Shilmulo Tarot is equipment, so its store sits on a
minion rather than at seat level.

**Burn when empty** ("if this location has no cards on it, burn it") is
checked wherever the store shrinks, alongside the existing
`burnWhenEmpty` for counters.

## 6. Draw substitution: "you can draw one of those cards instead"

Black Market Cache and Shilmulo Tarot both say:

> If you would draw a card from your library, you can draw one of those
> cards instead.

This is a **choice at draw time**, and `drawToReplace` is called from a
dozen places deep inside resolution. The implementation:
`drawToReplace` raises a `ChoiceFrame` **instead of drawing** when a live
store can supply the draw, and the answer performs the draw — from the
library, or from the store.

Three things make that safe rather than invasive:

- **It only fires when the choice is real.** A store with no cards, or a
  Shilmulo Tarot whose bearer is not ready, offers nothing and the draw
  happens normally. Both stores are small (three cards, two cards) and
  empty permanently once drained, so this is not a decision on every draw
  for the rest of the game.
- **`raiseChoice` already queues while an action resolves** and flushes
  afterwards (docs/choice-frames-design.md) — the hazard that would
  otherwise hang the settle loop. A replacement draw during action
  resolution simply lands a moment later, which is invisible: hand size is
  checked in the discard phase.
- **`applyChoice` draws directly, never back through `drawToReplace`**, or
  the choice would re-raise itself forever.

The existing `PermanentCounterSink` with `instead: "replacement"` (Visit
from the Capuchin) is a different thing and keeps precedence: it *skips*
the draw, where this *redirects* it. Skipping first is right — a draw that
does not happen cannot be redirected.

## 7. Playing out of the store — Fleshforge Chamber

> "Tzimisce you control can play cards from this location as if from your
> hand (requirements and cost apply as normal)."

That parenthetical is the same one the play-from-hand family carries
(docs/play-from-hand-design.md), so this is that machinery with the source
zone swapped: `playFromHandChoices` gains a `zone` and
`playCardFromHand` learns to pull from a store instead of the hand. The
filters, the cost, the requirement checks and the option-id shape are
unchanged.

## 8. A bug the first test caught: "find nothing" is not a pass

Both searches were first raised as **optional** ChoiceFrames, which is how
this engine offers a declinable question — declining is a plain `pass`.
That is wrong here, and the test that enumerated the options caught it:
a `pass` pops the frame **without calling `applyChoice`**, so it would
have skipped the shuffle that p. 14 and p. 48 both make mandatory.

The frames are now **non-optional**, and "Find nothing" is an ordinary
answer that carries the shuffle. The rule to remember: *an optional
ChoiceFrame is only right when declining it does nothing at all.* If
declining has a consequence, the decline has to be an answer.

## 9. Deferred

**Heart of Nizchetus** (100903) — "if the bearer is ready during your
unlock phase, you can draw up to 3 cards without discarding and then move
the same number of cards from your hand to the bottom of your library."
Pure library manipulation: no search, no store, so it is not part of this
gate, and it wants two things this wave did not build — a "draw up to N"
count choice and N successive "bury which card" choices. The `choiceByKey`
dispatcher added here (§10) is what makes that safe to add.

## 10. Two choice keys on one card

The store cards raise two different ChoiceFrames (a search and a draw
redirect), and Magic of the Smith raises a third kind. Assigning
`handler.choiceOptions` from each spec clause would mean the second
silently clobbered the first on any card carrying both — the
`POLLING_ONLY_EFFECTS` failure mode, which has already bitten this project
three times. The clauses now register into a `choiceByKey` map and one
dispatcher reads `frame.key`.

## 11. Rulebook citations

- p. 14 — "Search": no announcement, may find nothing, must shuffle after.
- p. 14 — contested unique cards are "turned face down and out of play",
  the rulebook's own precedent for cards that are neither in play nor in a
  pile.
- p. 16 — the unlock phase, and that effects during it resolve after
  unlocking, in an order their controller chooses (Shilmulo Tarot's
  top-card move).
- p. 20 — the equip action and its +1 stealth.
- p. 48 — the Magic of the Smith ruling quoted in §2.
