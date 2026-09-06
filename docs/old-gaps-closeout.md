# The old gaps, closed

2026-09-05, at the owner's request: five long-standing items, four built
and one already done. Contested cards and titles were scoped here and
built the next day — see `docs/contested-design.md`.

## 0. Reading the rulebook

Done with a ~40-line Node script using only `zlib` — inflate each page
stream, pull the text-showing operators — kept in the scratchpad rather
than added to the repo. `pdf-parse` would have been a dependency for one
afternoon's reading. Every rule quoted in this file and in
`docs/contested-design.md` came out of it verbatim.

## 1. "Who has looked at this card"

Recorded as a gap the day `PlayerView` was finished, and real since
Revelations (101627) — the first card in the pool that reveals hidden
information.

`GameState.knowledge` maps a seat to the card instance ids it has seen,
written by a `CardsRevealed` event emitted where the card says *look at
your prey's hand* — **not** in the choice's option list, which is a pure
read, and the actor has seen the hand whether or not they take anything
from it. `redactFor` unmasks a known card in somebody else's hand, and
`PlayerView.hand` for another seat became `{ count, known }`, where
`known` is a **subset**: they may have drawn since.

Keyed by card **instance** and never expired — you saw that physical
card. Event-sourced, so a replay remembers exactly what the original
player remembered.

**A live rules bug found while building it:** Revelations' *basic* mode
was putting the card into play, which is the **superior's** whole text
("Put this card in play. Your prey plays with an open hand") — so the
basic mode was granting a permanent open hand for the rest of the game.
`putsInPlayOnSuccess` is registered when **any** mode does it and was
returning a default entry for a mode with no such effect. It returns
`null` now and the engine falls through. Same shape as Wall of Filth's
aggravated filter: **a handler lookup cannot answer a question whose
answer differs by mode.**

## 2. Leaderboard

`src/ui/results.ts`: `resultFrom` and `standings` are pure, storage is
guarded. Recorded from the **transport**, for the game log's reason —
only the authority sees a game that bots finish. The sink is **injected**
(`onResult`), so the fuzz and the batch harness record nothing. A name
counts as a bot only if a person never played it.

## 3. Deck library

`src/ui/decklibrary.ts` stores the deck's **source**, not its cards: a
precon stays a pointer (so it follows the registry as the pool widens)
and a pasted list keeps the words, so the import report can be shown
again. `deckSummary` re-derives on every read through the same path a
game is dealt from — a deck saved today can stop being legal tomorrow.

It reaches the lobby by construction: the deck panel already served the
new-game screen and a lobby guest through one code path.

## 4. Diablerie steps 2 and 4

`docs/diablerie-design.md` §6 had said this needed "an equipment-move
primitive, which no gate has built". **It was stale**: `moveAttachment`
had existed since the granted-rush wave, and `attachFromZone`'s own
comment already named this use. That is the fifth cut-list or deferral
row in this project to name a blocker that had since been built.

**Step 2 (equipment) is taken automatically and synchronously**, before
the burn — a recorded reading. The resolution is an indivisible unit, and
a choice raised inside action resolution is *deferred until the action
settles*, by which time the victim and its equipment are burned.
Equipment that would duplicate a unique the taker already controls is
left to burn.

**Step 4 (the older victim's Discipline) is a real question**, engine-owned
like the discard-down, and lands **before the blood hunt** — the correct
p. 34–35 order: the resolution completes, then the referendum.

## 5. Withdrawal (p. 38)

> "If you have exhausted your library and begin your turn with less than a
> full hand, you have the option to withdraw from the game. To exercise
> this option, you must announce your intent to withdraw during your
> unlock phase. For the withdrawal to succeed, you must meet the following
> conditions: None of your minions enter combat until your next unlock
> phase. None of your minions lose (or spend) any blood until your next
> unlock phase. You do not lose (or spend) any pool until your next unlock
> phase. If you have met these conditions when you would start your unlock
> phase, you successfully withdraw. **The withdrawal fails if you lose a
> single blood or pool counter, even if you also gain enough to make up
> for the loss.** If you successfully withdraw, you receive 1 victory
> point … **Your predator does not get 1 victory point or any pool for
> your withdrawal.**"

Built as written. **1 VP, and the predator gets nothing** — which is the
whole reason to withdraw rather than be ousted.

**It is a latch tripped by the loss, not a comparison of totals** (that
is what the "even if you also gain enough" sentence buys), and the check
hangs on `emit`, the one point every event passes through.

**Three sites decide whether the unlock window stays open** — settle's
phase-advance, `turnDecision` and `applyTurnPass` — and all three had to
name the withdrawal. Missing one silently skipped the *other* seats'
"during any Methuselah's unlock phase" cards.

**Every fixture has an empty library**, so the option appears across the
suite; three existing traces gained a decision, which is the engine being
right rather than an artifact to suppress.

## 6. Go-getter superior — already done

The ledger-closeout pass had built it. The "Next" queue line in
`CLAUDE.md` naming it as outstanding was stale. Verified, not rebuilt.
