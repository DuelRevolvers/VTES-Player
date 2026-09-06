# Dealing a real game from real decks

2026-09-04. The second item pulled forward out of the platform shell spec,
and the one flagged as underestimated: **the client could not start a
game.** It could only start from a hand-authored MID-GAME snapshot —
vampires already in play, counters already spent, a pool that had to be
made to add up by hand. Nothing shuffled a crypt, dealt four face down and
put a Methuselah at 30 pool with an empty table.

That is a prerequisite for both of the next two builds. A lobby has
nothing to start and the deck importer has nothing to import *into* until
"deal a game from two real decks" exists.

---

## 1. What the rulebook actually says

p. 14, quoted because every number here is one of its numbers:

> "To begin, separate your crypt cards from your library cards. Shuffle
> both decks and allow your predator to cut both. Place both decks in
> front of you. **Draw the top seven library cards to form your hand and
> deal the top four crypt cards face down into your uncontrolled region.**
> You can look at the cards in your hand and in your uncontrolled region
> at any time during the game."

> "Each Methuselah must have **at least 12 cards in their crypt and
> between 60 and 90 cards in their library**. There is no maximum limit on
> the number of cards Methuselahs can have in their crypt. A Methuselah
> can include any number of copies of a given card in either their library
> or crypt within the limits indicated above."

> "Seating order can be determined by whatever method the Methuselahs
> choose. **Randomly determine a Methuselah to act as first Methuselah.**
> For each Methuselah, the Methuselah to your left is your prey."

p. 15: "Each Methuselah takes **30 blood counters** to form their starting
pool."

Two things did NOT need building, and finding that out was most of the
work:

- **"Face down" needs no flag.** The uncontrolled region is already masked
  to its owner by `redactFor`, which is where that rule lives and has
  lived since `PlayerView` was completed. A dealt vampire is face down for
  everyone else because the masking says so, not because the deal says so.
- **The transfer ramp is already right.** p. 24 gives the first
  Methuselah 1 transfer, the second 2, the third 3, and 4 thereafter —
  which is exactly `min(turnNumber, 4)`, already in the engine. Checked
  against a 5-seat table, where turn 4 is the fourth *Methuselah's* first
  turn and correctly gets 4.

## 2. A deck is not a position

`DeckDef` became a union of two genuinely different things, told apart by
a `kind` tag that only the new one carries:

- **`DeckList`** — a real deck: `crypt` and `library`, one entry per copy,
  and nothing else. Where anything starts is not part of a deck. This is
  what a player builds and what the importer will produce.
- **`SnapshotDeck`** — the existing hand-authored position: `ready`,
  `uncontrolled` with counters, `crypt`, `library`, `pool`.

Keeping the snapshot was not sentiment. Every scenario fixture in 157 test
files is one, and they exist to put the engine in a specific position
without playing twenty turns to get there. The two are not
interchangeable and pretending otherwise would have meant either breaking
1,600 tests or making a real deck carry five fields it has no answer for.

**Validation follows the same split**, and the difference is which
failures are fatal:

- p. 14's construction limits (`illegalDecks`) apply to a **real deck** and
  are **fatal** — a deck too small to deal cannot be played at all.
- The pool ledger (`poolMismatches`) applies to a **snapshot** and is
  **not** fatal — a scenario may want an odd pool. It is also meaningless
  for a dealt game, which always starts at exactly 30 having spent
  nothing.

A test pins both negatives: a snapshot is not judged by the deck limits,
and a dealt game is not asked to account for its pool.

## 3. Who goes first

"Randomly determine a Methuselah to act as first Methuselah" is
implemented as **a rotation of the seat array**, and that is the whole of
it. The table is a *cycle* — your prey is on your left — so rotating
changes where the cycle starts and changes nobody's neighbours. A test
walks twenty seeds and asserts the order is always a rotation of the
seating, never a reordering.

`GameSetup.firstSeat` overrides it, which is what a lobby will set once
seats are taken.

**The RNG is only touched when the choice is actually being made.** A
snapshot with no `firstSeat` keeps seat 0 and consumes nothing, so adding
this could not have changed the deal of any existing fixture or saved
game — pinned by its own test, because "it happens not to matter" and "it
provably cannot matter" are different claims.

## 4. What the fresh deal proved about the engine

The engine had **only ever been started mid-game**. Nothing had checked
that a seat with no minions at all can take a turn — and that is the
entire opening of a real game.

It can. The first forty decisions of a dealt game read exactly as the
rulebook describes: master phase, `end` in the minion phase because there
is nothing to act with, then influence, with the ramp handing the first
Methuselah 1 transfer, the second 2, the third 3, and 4 each thereafter. A
test plays a dealt game from an empty table to a finish.

**A walker lesson, for the fourth or fifth time:** the test that watches a
vampire come into play first prefered `inf:add` and never `inf:out`, so it
sat at capacity for ever and concluded influence was broken. Moving a
fully-influenced vampire to the ready region is a separate, last step. A
walker that only takes the obvious option proves nothing.

## 5. Not done yet

- **Nothing in the UI starts one.** `startFromConfig` will deal a fresh
  game if `config/playtest-decks.json` holds `kind: "deck"` entries, but
  there is no New Game screen — that is the shell's Host/Join flow.
- **No decks ship with the client.** The test builds legal decks from the
  registry rather than hand-writing lists, deliberately: a fixture that
  names cards can quietly stop matching the pool. Real deck lists are the
  importer's job, along with saying which sets and precons are supported.
- **Group legality is not checked.** V5 crypts are groups 5–7 and mixing
  distant groups is a deck-construction rule; `validateDecks` does not
  enforce it yet, and the importer is the natural place for it.
