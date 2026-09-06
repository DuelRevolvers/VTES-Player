# Contested cards and contested titles

Built 2026-09-06. The last of the pre-existing rules gaps named in
`CLAUDE.md`, and the only one that was still a real subsystem rather than
a patch.

## 1. The rules, verbatim

Read out of the V5 rulebook PDF with a `zlib`-only script (the approach
`docs/old-gaps-closeout.md` records), not paraphrased.

**Contested cards (p. 17, Advanced Rules):**

> Some of the cards in the game represent unique resources, such as
> specific locations, equipment, or people. These cards will be identified
> as "unique" in their card text. **In addition, all crypt cards represent
> unique minions.** If more than one unique card with the same name is
> brought into play, that means control of the card is being contested.
> For the duration of the contest, all of the contested cards are **turned
> face down and are out of play**. If another unique card with the same
> name is brought into play, it is immediately contested and turned face
> down as well.
>
> The cost to contest a card is **1 pool, which you pay during each of
> your unlock phases**. Instead of paying the cost to contest the card,
> you may choose to **yield** the card. A yielded card is **burned**. Any
> cards or counters stacked on the yielded card are also burned.
>
> If all other cards contesting your unique card are yielded, then the
> card is **unlocked and turned face up during your next unlock phase**,
> ending the contest.

And in the deck-construction caution box on the same page:

> You cannot control more than one of the same unique card at a time, and
> **you cannot voluntarily contest cards with yourself** (if some effect
> would force you to contest a card with yourself, then you simply **burn
> the incoming copy** of the unique card).

**Contested titles (p. 18):**

> Some titles are unique. For example, there can be only one prince or
> baron of a particular city. If more than one vampire in play claims the
> same unique title, then the title is contested. While the title is being
> contested, the vampires involved in the contest are **treated as if they
> have no title**, but they remain controlled and may act and block as
> normal.
>
> The cost to contest a title is **1 blood, which is paid by the vampire
> during each of their unlock phases**. Instead of paying the cost to
> contest the title, the vampire may choose to yield the title (**or may
> be forced to yield, if they have no blood to pay**). **Only ready
> vampires can contest titles. Vampires in torpor must yield during the
> unlock phase.**
>
> If all other vampires contesting a title with your vampire have yielded
> the contest, then your vampire acquires the title during your next
> unlock phase, ending the contest.
>
> The vampire yielding the title will now have no title and **loses the
> benefits of the title for the remainder of the game**.

**Which titles are unique** — three different shapes, from three places:

| Title | Unique per | Citation |
|---|---|---|
| prince | city — "contested by another vampire who claims **any** title to the same city" | p. 39 |
| baron | city — "contested by … prince, archbishop, or baron of the same city" | p. 40 |
| archbishop | city — "like Camarilla princes … contested by another vampire who claims any title to the same city" | p. 42 |
| justicar | clan — "each clan's justicar and Inner Circle titles are unique" | p. 41 |
| Inner Circle | clan | p. 41 |
| kholo | clan | p. 42 |
| regent | globally — "the title of regent is unique" | p. 42 |
| primogen, bishop, cardinal, priscus, magaji | **not unique, cannot be contested** | p. 41–42 |

## 2. Out of play is taken at its word

`SeatState.contested: ContestedCard[]` holds the card, and the card is
**removed from `permanents` / `minions` entirely**.

The alternative — leave it where it is with a `contested: true` flag —
was rejected, and the reason is this project's oldest failure shape. A
card in play is read by several dozen sites: `handSizeOf`, every aura and
static fold, every enumerator, every hook sweep, `allEntries`. Every one
of them would have had to learn to skip a contested card, and **a site
that forgot would look exactly like a card that legitimately does
nothing** — invisible to the typechecker and structurally invisible to
the fuzz, which plays whatever it is offered.

Moving the object needs nobody to learn anything. A test pins the
consequence directly: Elder Library's `handSize` static is simply not
there once it is contested.

The whole object is kept rather than just the name, because a contest
ends by the card coming **back** with everything on it — and because "any
cards or counters stacked on the yielded card are also burned" is only
answerable if the stack is still there to burn.

## 3. Detection is a SWEEP, not a hook

`settleContests()` runs in `settle()`, beside `burnDepleted()` and
`drainOverCapacity()`, and asks the board rather than being told.

A unique card reaches play down at least six paths (a master, an equip
action, a recruit, an influence-out, a control change, a card that puts
itself in play) and a title claim down three more. Instrumenting each is
exactly how `onAnyUnlock` missed attached cards, how `onBleedSuccess`
missed them again a wave later, and how `onActionAnnounced` fired a step
early for its whole life. The reading is the one `drainOverCapacity`
already takes: **the invariant holds whenever it becomes false, whichever
side moved.**

It must be idempotent or settle would loop forever, so it returns true
only when it actually emitted something: the second pass finds every copy
already in the pile and has nothing to move.

**The claimant is the CONTROLLER, not the seat holding the card.** p. 17
says "**control** of the card is being contested", and p. 16 is explicit
that a master played on another Methuselah's minion is still controlled
by the player who played it. So the sweep keys on
`entry.controller ?? <holder>`.

**What counts as unique:** `handler.isUnique` for a card in play; **every
vampire** (p. 17's "all crypt cards"), except the two token vampires,
which print "non-unique" in as many words and now carry
`MinionState.nonUnique`. An ally is an ordinary library card and is
unique only if it says so — read off its own self-attached entry, which
is where an ally's printed card lives.

## 4. Paying and yielding: an engine-owned ChoiceFrame

`CONTEST` joins `HAND_SIZE_DOWN` and `DIABLERIE_DISCIPLINE` as a choice
key answered by the **engine** rather than by a card handler, for the
same reason and one more: a contest can be over a card whose handler
knows nothing about contests, or over a **title**, where there is no card
to ask at all.

It is a **repeated, non-optional** frame — one question at a time,
re-raised — the `unlockToll` shape, because each answer changes the board
the next question is asked against. `TurnFrame.contestsHandled` records
how far the phase got, since the cost is paid "during **each** of your
unlock phases" and not once per settle.

Order inside the unlock phase, from p. 17 ("any cards or effects that
require or allow you to do something during your unlock phase take effect
**after** you have unlocked your cards"): unlock sweep → **contests** →
Edge → unlock-phase abilities.

Within the contest step: wins first, then the forced yields, then the
real questions. Wins go first because "acquires the title during your
next unlock phase" is not conditional on anything the seat then does.

## 5. Readings on record

- **A Methuselah is never "unable to pay" for a card contest.** p. 17
  puts no floor under the payment, and a Methuselah at 0 pool has already
  been ousted — so spending your last pool on a contest is a legal, bad
  choice, exactly as Smiling Jack's ruling makes it ("you have to move 1
  pool to the card **even if it ousts you**"). The affordability gate in
  the option list is therefore unreachable defence, and the test pins the
  *reason* rather than asserting a branch that cannot happen.
- **A yielding vampire loses its `titleCity` too**, not just its title.
  "Loses the benefits of the title for the remainder of the game" — and
  keeping the city would put them straight back into the contest on the
  next sweep.
- **An attached card whose bearer is gone when its contest is won is
  burned.** p. 17 says the card "is unlocked and turned face up", and
  says nothing about where an equipment goes when the vampire it was on
  has been burned meanwhile. There is nowhere for it to return to.
- **The contested pile is shown to the table, with names.** Turning a
  card face down marks it out of play; it does not hide which card it is,
  since everyone watched it go down. And a pile costing its holder a pool
  a turn is something the other players are entitled to see.
- **A title contest CAN be within one Methuselah.** p. 17 forbids
  contesting a *card* with yourself; p. 18 says no such thing about
  titles. Two of your own vampires claiming one city both lose the
  benefit until one yields.

## 6. The title city — the `path` lesson, exactly

`MinionState.titleCity` is a **printed crypt trait**, read straight off
the card text like clan, sect and path before it. It was already in the
data and the parser was dropping it: `importCryptCard` stripped
`\s+of\s+.*$` to find the title word and threw the remainder away.

That is the `path` failure verbatim — `docs/path-cards-design.md` §0
records `build-registry.mts` silently dropping KRCG's `path` field, and a
whole wave being designed against a blocker that was one line of pipeline.
`CLAUDE.md` had this one written down as "**`MinionState` carries no
title city** — the `path` lesson again", which turned out to be right
about the diagnosis and to overstate the cost: it was a parse, not a
pipeline change, because the city is in the card TEXT rather than in a
KRCG field.

**And my first survey of that data was wrong.** A scratchpad script
reported 25 city titles over 24 cities with exactly one repeat
(Mannheim), and the real answer is **43 city titles over 41 cities with
two repeats**. The regex only read title lines ending in `:` and missed
every one ending in `.` — which is the difference between a vampire with
ability text and one without, i.e. about half the crypt. The finding
survives as a test rather than a note:

> **Mannheim and Pittsburgh each have a prince, a baron AND an
> archbishop.** Those are not accidents of a large card pool; they are the
> designers building p. 39's "contested by another vampire who claims any
> title to the same city" into the V5 crypt on purpose. They are the title
> contests this card pool actually contains.

## 7. How reachable is any of this?

Measured over the 32 precons in the registry, 496 pairs:

- **62 pairs (12.5%) share a unique library card** — Creepshow Casino,
  Information Highway and Dreams of the Sphinx are the common ones.
- **14 pairs share a crypt card**, mostly a clan's Fifth Edition deck
  against its New Blood deck.
- **127 of the 444 library cards are unique.**

So this is not an edge case that needed modelling for completeness. Two
players picking decks of the same clan will contest a vampire, and one
pair in eight will contest a location.

## 8. What this changed elsewhere

**One existing test had to be rewritten, and it was the engine being
right.** `diablerie.test.ts` asserted the equipment-take's own-duplicate
guard on a board where Alice and Bob each controlled a Treasured Samadji
— which contested rules make **unreachable**: they contest, both go out
of play, and there is no equipment on the victim to take. The guard is
kept as defence in depth and the test now pins the reason it no longer
fires.

**Nothing else moved.** 1825 tests, and the only change outside the new
file was that one. The reason is §2: because a contested card leaves the
arrays, no existing read had to learn about it.

## 9. Not built

- **Contested cards do not interact with `seatControlsCopy`.** That gate
  still prevents a seat playing a second copy of a card it already
  controls, which is p. 17's "you cannot control more than one of the same
  unique card at a time" and is a separate rule from contesting.
- **Kholo and magaji are not `VampireTitle` values** — they are Laibon
  titles and the V5 crypt has no Laibon. `titleContestKey` would key kholo
  on the clan if the type ever gains it; magaji is not unique, so it
  never needed one.
- **A contested card is not a legal target of anything.** It is out of
  play, so no enumerator can see it — which is the point of §2, but it
  does mean an effect that says "a card in a contest" (there is none in
  V5) would need its own accessor.
