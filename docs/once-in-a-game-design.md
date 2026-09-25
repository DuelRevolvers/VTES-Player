# Once in a game — design (wave 90)

Four political actions that name a **vampire** and pay out from what that vampire
*is*, in **two pairs of twins**. Each pair differs in exactly one thing, and that
one thing is the thing a reader gets backwards.

| Card | KRCG | Text |
| --- | --- | --- |
| Ancient Influence | 100064 | Only one Ancient Influence can be played or called in a game. Successful referendum means each Methuselah can choose a ready vampire they control. Each Methuselah gains pool equal to their chosen vampire's capacity, then burns 5 pool. |
| Reins of Power | 101591 | Only one Reins of Power can be played or called in a game. Successful referendum means each Methuselah can choose a ready vampire they control. Each Methuselah gains 6 pool, then burns pool equal to the capacity of their predator's chosen vampire. |
| Camarilla Exemplary | 100284 | Requires a Camarilla vampire. Choose a Camarilla vampire. Successful referendum means that for the remainder of the game, any vampire attempting to block that vampire burns 1 blood. |
| Sabbat Priest | 101667 | Requires a ready Sabbat vampire. Choose a ready Sabbat vampire. Successful referendum means that for the remainder of the game, any vampire attempting to block the chosen vampire burns 1 blood. |

Printed text read from `data/vtes-raw.json`.

## 1. Why two pairs rather than four cards

A pair of near-identical cards is the cheapest correctness test this project
has. Ancient Influence and Reins of Power share one primitive and differ only in
**which seat's choice each number reads**; Camarilla Exemplary and Sabbat Priest
share one existing primitive and differ only in **which sect they name**. Either
card of either pair would look perfectly right with its difference reversed, and
nothing but the sibling makes that visible.

The block-toll pair also needed no new code at all: `refAttachToChosen` already
puts a card on a referendum-chosen vampire filtered by sect, and `blockToll`
already taxes anyone attempting to block the bearer — both written for **Archon**,
which is these two cards plus a rush grant and blood-hunt immunity.

## 2. The per-seat choice sweep

`refEachSeatChoosesVampire` is the new primitive:

```ts
gain: { flat: number } | { capacityOfChosen: "own" }
burn: { flat: number } | { capacityOfChosen: "predator" }
```

Both halves **name their source** rather than relying on position, so the two
cards read as opposites in the spec the way they do on the card.

Three decisions worth recording:

**The choice is MANDATORY with a "choose nobody" answer**, not optional with a
decline. The cards say "*can* choose", so declining must be possible — but a
declined optional choice is a plain `pass` the handler is never told about, and
this payout cannot run until every asked seat has answered. An optional choice
would have stranded the payout forever the first time somebody declined. That is
the `refBurnAllKeepable` lesson, applied before it bit rather than after.

**The payout runs once, after the last answer**, and the last answer is
identified by recomputing which seats were askable rather than remembering a
count — nothing can have changed it, because a choice frame asks nobody else
anything. A seat's answer lives on `SeatState.referendumVampireChoice`, where
`null` is the real answer "nobody" and *absent* means "not asked yet": the
difference between those two is what tells the payout it is last. The field is
deleted when the payout runs, the `bloodHuntVoteRiders` pattern.

**The payout runs for every STANDING seat, asked or not.** "Each Methuselah …
then burns 5 pool" charges a seat with no vampire at all; its gain is simply 0.
Only seats with a ready vampire are *asked*. And every amount is computed before
any pool moves, so one seat's payout cannot be changed by another's — the cards
read capacities, not pools, and that stays true only if nothing is emitted
mid-loop.

**Polarity: `"other"`.** Both cards move pool in both directions on every seat at
once; a 10-capacity vampire makes Ancient Influence a gain and a 3-capacity one
makes it a loss, so there is no sign to declare to the AI. The
`REFERENDUM_POLARITY` record made this a compile error until it was declared,
which is the design working.

## 3. What the wave found

Nothing broken — the second wave in a row where the mechanism held, and for the
same reason: per-seat choice sweeps during a referendum's resolution had already
been built once (the keepable-ransom family), and the second user of a pattern is
where you find out whether the first one generalised. It did.

What it did cost was **three separate places a new referendum primitive has to be
declared**, none of which the previous one would have told you about:

1. `REFERENDUM_POLARITY` — a `Record` over the `ref*` kinds, so this one is a
   compile error until declared. Designed to fail loudly, and it did.
2. `EFFECT_TAGS` in `summary.ts` — the same shape, also a compile error.
3. The choice key must be registered in `choiceByKey` **and** raised with that
   exact string in the apply. Nothing checks that pair; a typo in either is a
   referendum that passes and does nothing.

Two of the three fail at compile time by deliberate design; the third is the one
to watch, and it is the same shape as wave 88's install guard and wave 87's
target rider — **a vocabulary spelled out in more than one place**.

## 4. Tests

`tests/cards/once-in-a-game.test.ts` — 10 cases.

The fixture gives the three seats vampires of capacity **6, 4 and 9** — all
different on purpose. With equal capacities, a payout that read the wrong seat's
choice would produce the right number and pass. The two pool cases then assert
*three different deltas* from one card, and the Reins of Power case asserts a
completely different set of three on the same board — which is what pins that the
twins did not swap.

Also pinned: a seat choosing nobody still pays Ancient Influence's flat 5, and a
*predator* choosing nobody makes Reins of Power's 6 clear profit; the
once-in-a-game bar refuses a second copy even with a second vampire to call it;
each block-toll card offers only its own sect as terms and refuses the other's;
and neither is playable by a caller of the wrong sect.

Mutation-checked: reading your own choice instead of your predator's (fails both
Reins of Power cases, nothing else), and paying on every answer instead of the
last (fails all four pool cases). Clean on restore.

Fuzz: all four added. The two table referendums are the fuzz's first per-seat
choice sweep inside a referendum, and they can oust several seats at once, which
the pool-conservation replay has to agree with.

## 5. Counts

Library 828 / crypt 217 / total 1045; supported 927 / 1045.
