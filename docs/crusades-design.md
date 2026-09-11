# The Crusades — and the city a granted title never recorded

*Crusade: Atlanta, Chicago, Detroit, Frankfurt, Houston, Mexico City,
Miami, New York, Paris, Philadelphia, Pittsburgh, Toronto (100453–100472).*

Wave 19, landed **v0.10.2**. Library **558 → 570**.

Twelve cards, one factory, and the exact mirror of the Praxis Seizures
from wave 13:

> "Requires a **Sabbat** vampire. Title. If this referendum passes, put
> this card on the acting vampire to represent the unique Sabbat title of
> **Archbishop of \<city\>**. This could lead to a contested title."

Everything they need already existed — `requiresSect`, `refPutInPlay`
with `onActor`, the `archbishop` title at 2 votes (p. 28), the contest
machinery. They were expected to be pure data. **They were not, and the
reason is a bug thirteen cards old.**

## 1. §0 first: are there Sabbat vampires?

Yes — **48 of the 217 crypt cards** print a `Sabbat:` line, and the deck
importer parses the sect off that text (`cardinfo.ts`), so the requirement
has real targets and none of the twelve is inert.

Worth recording that the pool's sects are *derived from printed card
text*, not a registry field: `registry.json` has no `sect` on a crypt
entry, and a query that looks for one finds nothing and would report the
family inert. That is a trap, and it caught me once this session in a
different form.

## 2. The defect: `TitleGranted` carried no city

`titleContestKey` keys **prince, baron and archbishop on the CITY ALONE**,
and says why in its own comment: p. 39 — a prince "can be contested by
another vampire who claims **any title to the same city**" — with p. 41
ruling archbishop the same way and p. 40 doing baron. It reads
`MinionState.titleCity`.

Nothing that grants a title from a card ever wrote that field.

```ts
case "TitleGranted":
  getMinion(this.state, ev.minion).title = ev.title;   // and nothing else
```

`titleCity` was written in exactly two places: the crypt importer (a
vampire who prints "Prince of Mannheim") and test fixtures. So **every
Praxis Seizure prince since wave 13 keyed on `null`** — the branch whose
comment reads "no city printed means nothing to contest OVER" — and
contested with nothing.

It looked correct because wave 13 fixed a *different* uniqueness: card-level
`isUnique`, which makes two copies of **Praxis Seizure: Chicago** contest.
That is one of the three shapes of title uniqueness, and the wave's note
recorded it as the fix. The city is a second shape, and a Prince of
Chicago against an **Archbishop** of Chicago is two different cards, so
card-level uniqueness cannot see it at all.

The Crusades are what made it visible. Without them, every card-granted
title in the pool was a prince, and prince-against-prince happened to be
covered by the card-level path — a wrong answer that no reachable
position could produce.

**The fix is one field with one owner.** `TitleGranted` gains an optional
`city`, the event applies it, and `refPutInPlay` carries `grantsTitleCity`
from the spec. Both factories pass the city they already knew — it was
sitting in the permanent's tag (`Prince of Chicago`), where nothing that
matters could read it.

This also retro-fixes the thirteen Praxis Seizures: a Praxis prince now
contests a crypt vampire who prints the same princedom, which p. 39
required all along.

## 3. Twelve of twenty-three

Eleven Crusades add a rider naming a clan or a vampire the pool does not
have — "if this vampire is **Tzimisce**, they unlock during your next
discard phase", "if **Lucita** is in play and is Sabbat, put this card on
her instead". Building those would be building an inert clause, so they
wait for §7 exactly as the nine leftover Discipline masters do.

**Five of the twelve omit "this could lead to a contested title"**
(Detroit, New York, Philadelphia, Pittsburgh, Toronto) and are built
identically to the seven that print it. That sentence is reminder text for
a rule on p. 39; the rule applies whether or not a printing repeats it,
and making the card behave differently because a printing is terser would
be the Golden Rule read backwards.

## 4. Tests

Added to `tests/cards/praxis-seizure.test.ts`, which already owns this
mechanism — four tests:

- a Crusade makes its Sabbat caller **Archbishop of that city**, with
  `titleCity` set and `titleContestKey` answering `city:chicago` — the
  assertion that would have returned `null` before this wave;
- all twelve are offered to a Sabbat vampire and each names **its own**
  city, checked against the printed text in the registry — the one thing a
  twelve-row table can get wrong that nothing else would notice;
- not offered to a **Camarilla** vampire;
- a Prince of Chicago and an Archbishop of Chicago produce the **same**
  contest key — written as two `toBe("city:chicago")` assertions rather
  than comparing them to each other, because two `null`s would satisfy
  that comparison and `null` is exactly what the bug produced.

**Not added to the fuzz decks**, following the thirteen Praxis Seizures,
which are not there either: the fuzz vampires have no sect, so a
sect-requiring card is an unplayable deck slot that only reshuffles the
seeded games. `library-audit.test.ts` — which requires every supported
card to be named by some test — is satisfied by the twelve-name table.
