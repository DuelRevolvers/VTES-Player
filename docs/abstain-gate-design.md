# The abstain gate — unmaking votes that have already been cast

Status: **design + implementation** (2026-08-30). Queue item 1. The last
of the per-gate deferrals listed against `docs/politics-design.md`,
`docs/ballots-design.md` and `docs/polling-votes-design.md`.

## 1. Why these five were deferred together

Everything the politics kernel does today is **additive**: a vote source is
enumerated, cast, and appended to `ReferendumFrame.votes`, and the tally is
a fold over that array. Nothing had ever needed to *remove* a vote, *stop*
a referendum, or *outlive* the tally. These five cards each break one of
those assumptions:

| id | card | what it breaks |
|---|---|---|
| 101686 | Scalpel Tongue | un-casts votes already cast |
| 101951 | Telepathic Vote Counting | un-casts votes; **or** cancels the whole referendum and gives the card back |
| 101692 | Scorn of Adonis | an effect that fires **after** the tally |
| 102276 | Expulsion | a restriction that outlives the referendum (all turn) |
| 102201 | Yoruba Shrine | makes a referendum, or a directed action, **fail** |

## 2. Abstaining is not "casting zero"

> Choose a vampire who has cast votes or ballots in this referendum. The
> chosen vampire is locked and abstains (**this cancels the chosen
> vampire's votes and ballots**). — Scalpel Tongue

Two effects, and they must not be conflated:

1. **Retroactive** — votes already in `ref.votes` with that vampire as
   their `source` are removed. The tally is a fold, so removing the entry
   is the whole of it.
2. **Prospective** — they cannot cast again. Adding the id to
   `usedSources` would do it, but that field means "this source has been
   spent", and a vampire who never voted has nothing spent. So abstaining
   is its own list: `ReferendumFrame.abstaining: MinionId[]`, checked in
   the vote enumeration beside `usedSources` and `voteRestriction`.

**Votes and ballots need no separate handling.** Both are keyed on the
casting vampire's minion id in `ref.votes.source`, so cancelling by source
takes both — which is exactly what the parenthetical says.

Scalpel Tongue additionally **locks** the chosen vampire (and at superior
burns 1 of their blood); Telepathic Vote Counting superior forces the
abstention with no lock. So the lock is the card's, not the mechanic's:
`forceAbstain(minion)` does the abstention and nothing else.

**"Who has cast votes or ballots"** is a real restriction on Scalpel
Tongue's target and is enumerated as such — a vampire who has not voted is
not a legal choice. Telepathic Vote Counting says only "a vampire", so any
vampire with a live vote source is.

## 3. Cancelling a referendum is not failing one

Telepathic Vote Counting inferior and Yoruba Shrine look alike and are not:

> **Cancel** the referendum. If you played a political action card to call
> this referendum, **return it to its owner's hand** (discard down
> afterward). — Telepathic Vote Counting

> …have the action or referendum **fail**. — Yoruba Shrine

A **cancelled** referendum never resolves: no `ReferendumResolved`, no
`applyReferendum`, and the calling card goes back to hand rather than to
the ash heap. A **failed** referendum resolves normally with `passed:
false`, which matters because a failed title-granting referendum burns its
held card (p. 27) — a rule the cancel path must not trigger.

So: `cancelReferendum()` pops the frame and returns the card; a hand over
its size discards down. `failReferendum()` sets a flag the tally honours.

## 4. Scorn of Adonis: the first post-tally effect

> Methuselahs casting (including controlling a minion casting) votes or
> ballots against the referendum burn 1 pool **once results are tallied**.

Nothing had ever survived the tally. `ReferendumFrame.postTally` is a list
of pending effects, applied in `resolveReferendum` **after**
`ReferendumResolved` is emitted and regardless of the outcome — the card
says "once results are tallied", not "if it passes".

"Including controlling a minion casting" is why the burn is computed from
`v.seat` on each against-vote rather than from the minion: `ref.votes`
already records the seat that cast each vote, so a Methuselah who voted
against by any route is caught, and each is charged **once** however many
against-votes they cast.

## 5. Expulsion: a restriction that outlives the referendum

> Choose up to two minions. Successful referendum means the chosen minions
> cannot play reaction cards, block or cast votes or ballots **this turn**.

The three verbs land in three places, but two of them share a chokepoint:
`canReact(m)` already gates **both** reaction-card enumeration and
`blockOptions`. So `MinionState.expelledThisTurn` is read there and in the
vote enumeration, and cleared on `TurnBegan`. Note it does **not** stop the
minion acting — `canAct` is a different predicate, and the card does not
say they cannot act.

"Up to two" is chosen in the referendum **terms**, which are picked only on
success (p. 25) — the existing term machinery, no new work.

## 6. Yoruba Shrine, and the clan-name trap

> If a ready **Assamite** you control is the target of a directed action or
> is chosen by the acting Methuselah in the terms of a referendum, you can
> lock this location to unlock the acting minion and have the action or
> referendum fail.

**"Assamite" is not a clan the engine knows.** `MinionState.clan` holds
registry names, so this is **Banu Haqim** — the exact bug recorded against
Priority Contract, which filtered the legacy name and would have matched no
imported vampire. `tests/cards/clan-vocabulary.test.ts` guards it.

The card also *unlocks the acting minion*, which is unusual — it undoes the
lock the announcement imposed, so the actor is free to act again.

## 7. Deferred: Saulot's Guiding Wisdom (102258)

The abstain half is now available to it, but the card needs two more
things that are their own work: **a title worth 2 votes that is not one of
the eleven `VampireTitle` values** (TITLE_VOTES is a fixed map, so this
wants a `MinionState.bonusVotes` source that does not depend on a title at
all), and **"lock before range is determined to end a combat involving
another minion you control"** — a combat-ender fired from outside the
combat by a minion not in it. Neither is abstain work; both deserve their
own pass, with Touch of Valeren (102262) and Huldu, which want the same
outside-the-combat shape.
