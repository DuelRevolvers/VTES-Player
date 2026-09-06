# The token-vampire gate — 2 cards

**Unblocked by the owner on 2026-09-03**, the last gate but Paths. Two
cards, and they are the same card twice:

| Card | id | Printed text |
|---|---|---|
| **Waters of Duat** | 102159 | +1 stealth action, 1 blood. "Requires a non-sterile Follower of Set with capacity 5 or more. Put this card in play. It becomes a **1-capacity (non-unique) Follower of Set** and **must hunt this turn**. You can search your library (shuffle afterward), hand, and/or ash heap for a Discipline master card and put it on this new vampire." |
| **Childe of the Revolution** | 102246 | +1 stealth action, 1 blood. "Requires a non-sterile **baron**. Put this card in play. It becomes a **1-capacity (non-unique) Anarch vampire of the same clan as the acting vampire** and must hunt this turn. \[same search\]" |

---

## 1. What the rulebook does and does not say

**It has no notion of a library card becoming a vampire**, does not use the
word "token", and rules neither card by name. So the shape of this is a
design decision, and §§2–4 record the readings.

It does, however, define the trait both requirement lines name — glossary,
p. 42:

> **Sterile:** Sterile vampires cannot perform actions to put new vampires
> in play.

That is worth having in full, because it is the *general* rule these two
cards are the instance of: they are the only "actions to put new vampires
in play" in the pool, so the word "non-sterile" on them is the rulebook's
own cross-reference.

Two more that the design leans on and that already work:

- **p. 21** — a ready vampire with no blood **must hunt**, as a mandatory
  action, before any non-mandatory one (p. 19).
- **p. 16** — "a burned card goes to its owner's ash heap"; a card
  *removed from the game* "cannot be retrieved or affected in any way".

## 2. A token vampire is an ALLY with `kind: "vampire"`

The engine has turned a library card into a minion since the
allies/retainers gate: that is exactly what an ally is. A token vampire is
the same machinery with `kind: "vampire"`, `capacity: 1`, a clan and a
sect — no new zone, no new lifecycle, and every existing question about a
minion (can it act, block, be blocked, be rushed, be diablerized) answers
itself.

**Its own card rides as a SELF-attached entry, exactly like an ally's, and
that is load-bearing rather than decorative.** `burnMinion` burns every
attached card, so the self entry is what files the CARD in its owner's ash
heap when the vampire dies (p. 16). Without it the card would simply
vanish from the game — and, since the ash heap is public and searchable,
the difference is visible to players.

**What it is NOT:** a crypt card. It has no group, no printed disciplines,
no title, and it never touches the uncontrolled region. "Non-unique" needs
no modelling at all — crypt uniqueness is unmodelled and out of scope
(CLAUDE.md's recorded deviation), so the word is already true.

## 3. "…and must hunt this turn" needs NO code

The token enters with **0 blood**, and that is derivable from the card
rather than assumed: it says the vampire must hunt, and a vampire that
arrived with blood would have no reason to.

p. 21's mandatory-hunt rule then produces the printed sentence exactly.
`minionPhaseOptions` already filters `kind === "vampire" && blood === 0`
and, when any such vampire exists, **offers nothing else at all** until it
hunts. The clause is emergent.

**Recorded limit:** the engine's rule is "while at 0 blood" where the card
says "this turn". The two come apart only if the token gains blood some
other way before it acts, which nothing in the pool can do at that moment
(it is not in combat, and no card targets a vampire that did not exist a
moment ago). Worth knowing rather than worth building.

## 4. Sterile: a real trait with no source in the pool

The rulebook defines it, and **no V5 card grants it** — a survey of all 661
cards finds the word on exactly these two, both as a requirement. So
`MinionState.sterile` is set by nobody today and the filter correctly
passes every vampire.

It is modelled rather than skipped because it is a **rulebook trait**, and
because phase 7's crypt importer is precisely where it would come from —
the same position `clan`, `sect` and `title` are in right now (fixtures set
them; the importer will). The Wall Street Night standard: a clause that
matches nothing today is worth having when the rest of the card plays, and
a test pins that it is empty for the *right* reason.

## 5. A bug this gate exposed: removing a minion that IS a card

`removeMinionFromGame` burned every attached card, including the minion's
own self-attached entry — and `PermanentBurned` files the card in the ash
heap. So a minion removed *from the game* was leaving its card in a public,
searchable zone, which p. 16 says must not happen.

Nobody could see it until last wave: **Heartrender removes itself from the
game, and Split the Veil returns a wraith ally from the ash heap** — so the
Heartrender could be removed and then come back. The comment on
`removeMinionFromGame` had predicted the problem ("when it exists, this is
the branch that must not put the card there") and the ash heap existed
before the branch was updated.

`PermanentBurned` gained an optional `removed` flag, set only for the
minion's *own* card. Its equipment and retainers are still burned to the
ash heap, which is what p. 16's own sentence says: "any counters or other
cards on it are burned".

## 6. The Discipline search — three zones at once

> You can search your library (shuffle afterward), hand, and/or ash heap
> for a Discipline master card and put it on this new vampire.

The library-search gate (`docs/library-search-design.md`) settled the rules
this inherits, and they are the same here: p. 14 says you need not announce
what you are looking for, **searching can fail**, and you **must shuffle
the library afterwards**; p. 48's ruling adds that you may **choose to find
nothing** even when a legal card is there.

Two things are new:

- **Three zones in one search.** Existing searches read one zone each
  (library for Magic of the Smith, ash heap for Psychophagia). The
  candidate list is simply the union, with each option carrying the zone
  it came from, and **the library is shuffled whenever the library was
  among the zones searched** — which, since the searcher may look at it
  and decline, means always.
- **The hand.** No card had searched a hand before. It needs no masking
  work: the searcher is looking at their *own* hand, which they may
  already read.

The Discipline masters themselves were built by the derived-traits wave and
carry `tags: ["discipline"]`, so identifying them is a tag test rather than
a list of six names that could rot.

**Hidden information:** the candidates appear only inside a ChoiceFrame
addressed to the searching seat, and the event log records only what was
taken — the same treatment the library-search gate established. A searcher
learns their own library, which leaks to nobody.

## 7. Readings on record

- **"Follower of Set" is the Ministry.** The fifth card to print a legacy
  clan name (after Priority Contract, Yoruba Shrine, Haqim's Law and Opium
  Den), and `tests/cards/clan-vocabulary.test.ts` exists because of it.
  Both the requirement and the created vampire read **Ministry**.
- **"Requires a non-sterile baron"** is a title requirement, and `baron`
  is one of the eleven `VampireTitle` values — and one of the three CITY
  titles, though nothing here needs that.
- **The token enters ready and unlocked.** No rule stops a vampire acting
  the turn it enters play; p. 22's "cannot act the turn it is recruited"
  is an ALLY rule, and this is not an ally. It has to be able to act, or
  "must hunt this turn" would be unsatisfiable.
- **The acting vampire is not the token's parent in any modelled sense.**
  Childe reads the actor's clan once, at resolution; nothing links the two
  afterwards.
- **The search is optional and the card still enters play if it finds
  nothing** — two independent sentences, and the second says "you can".
