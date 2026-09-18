# Blood at the referendum

Tranche 3, wave 38. Library **630 → 633**. Three action modifiers played
during the polling step, all of which move **blood** rather than pool.

| Card | KRCG | Printed |
|---|---:|---|
| Mob Rule | 101230 | Each vampire with a **capacity above 4** can burn blood to gain votes. 1 vote per blood; a vampire with **capacity above 7** gains an **additional** vote for each blood. |
| Rant! | 101541 | Requires a ready anarch; before any votes are cast. Each **ready anarch** may burn **1 blood** to gain 1 additional vote. **If the referendum fails, this acting vampire takes 2 unpreventable damage.** |
| Cheval de Bataille | 100337 | Requires a ready **titled Sabbat** vampire. Any vampire casting votes or ballots **against** this referendum **burns 1 blood when the results are tallied**. |

§0 check: the pool holds **19 titled Sabbat vampires** (the Sabbat V5
crypt), so Cheval de Bataille is not inert — worth checking rather than
assuming, since "titled Sabbat" is two filters at once.

## §1 — A vote you buy, in an engine with no held votes

The engine models voting as **sources**: a vampire spends its votes once,
at a count read when it casts, and the source goes into `usedSources` so
it cannot cast again. "Gain votes" has no place in that model — there is
nowhere to hold a vote between gaining it and casting it.

So a bought vote **is a cast**: each purchase burns 1 blood and casts its
votes immediately, in a direction chosen at the moment of buying. That
matches the ruling exactly — *"Methuselahs can choose to burn one blood at
a time and wait to see"* — and it is why the purchase does **not** spend a
vote source: the vampire's own title votes are still theirs, and the offer
stays open for another blood.

`bloodVoteOffers` lives on the referendum frame and is read by **every**
seat's polling enumeration, not the card player's. That is the whole point
of both cards: Mob Rule hands the table a lever, and your prey can pull it
harder than you can.

Two shapes of limit, and they are different fields: Mob Rule is
**unlimited** with a second tier above capacity 7, Rant! is **one blood
per anarch** (`maxBloodPerMinion`). A `tollFrom` was added to the vote
option because a bought vote's source is `blood:<minion>`, which is not a
minion id — the existing per-cast toll (Alexander Silverson) charges the
source itself.

## §2 — A tax that reaches backwards

Cheval de Bataille looks like Alexander Silverson's *"vampires must burn 1
blood to cast votes against"*, which the engine already has as a per-cast
toll. It is **not** that card: *"will cause the loss of blood to vampires
voting 'no' **before it is played**, as well as after"* [RTR 19951110]. A
per-cast toll cannot reach a vote already cast, so this can only be a
sweep at the **tally**, over `rf.votes`.

A vampire that cast against twice pays twice. The card taxes the
**casting**, and the ledger of castings is what `rf.votes` is — so the
sweep iterates votes, not voters.

## §3 — One hook, a different currency

Rant!'s failure clause reuses `referendumFail`, which existed for The
Final Nights' *"the acting vampire burns 1 blood"*. Both fields are now
optional on that object and the damage arm is environmental (`source:
null`), so nothing can dodge or prevent it (p. 31) — which is what
"unpreventable" means here.

The ruling *"cannot be used during a referendum that is automatically
passing"* [PIB 20150105] needs no code: an auto-passing referendum is
written directly with a margin of 0 and never opens a polling step, so
there is no window in which to play the card.

## What the wave found

**Nothing broken.** The interesting part is a distinction the pool forced:
two cards that read almost identically in English ("vampires burn blood
when they vote against") are **different mechanisms**, and only the ruling
says so. Alexander Silverson prices a vote at the moment of casting;
Cheval de Bataille prices the whole referendum's opposition at the tally.
Implementing the second as the first would have passed any test written
from the card text alone and been wrong in every game where it was played
late — which is when it is played.

That is worth recording as a shape: **when a new card looks like one
already built, the ruling is where the difference lives**, and the
difference is usually *when*, not *what*.

## What is left

**Emissary is deferred**: *"any Camarilla vampire older than that anarch
can lock to cancel that anarch's votes and ballots"* is a cross-seat
optional response to a vote already granted, which is a window the
referendum frame does not have.

## Tests

`tests/cards/referendum-blood.test.ts`, 3 tests. The negative one pins
"above 4" as strict: a capacity-4 vampire is offered nothing. Rant! is
covered by the fuzz decks rather than its own scenario — it is Mob Rule's
offer with a cap and a sect filter.
