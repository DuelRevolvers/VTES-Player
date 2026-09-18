# Table-wide pool swings (wave 61)

*2026-09-17, platform v0.10.52. Library 712 → 716.*

**Cards:** Treaty of Tyre Enforced (102019), Political Stranglehold
(101417), Can't Take it with You (100289), Mark of the Damned (101167).

## §1 The family

Four referendums that hand **every Methuselah at once** a bill or a
windfall, counted from something they control:

| | counted | rate | flat |
|---|---|---|---|
| **Treaty of Tyre Enforced** | Banu Haqim they control | −1 each | **−1 more, always** |
| **Political Stranglehold** | their vampires of capacity 8+ | +3 each | — (and once per GAME) |
| **Can't Take it with You** | their equipment, locations and retainers | −1 each | **+1 first, to everyone** |
| **Mark of the Damned** | vampires in their **prey's** ash heap | −1 each | — |

`refPerMinion` already did most of this — four legacy referendums built on
it in tranche 3 wave 6 — so two of the four are a filter away. The other
two count things that are not minions, which is the new primitive.

## §2 Two primitives, not one with a discriminated count

`refPerSeatCards` is `refPerMinion`'s sibling rather than a widening of
it. The payment rule is the shared part and it is three lines; the COUNT
is all that differs. Folding a union into `refPerMinion.who` would have
put a shape four existing cards read behind a discriminator none of them
use.

**The tally reads entries, not `seat.permanents`.** "Each equipment,
location or retainer card he or she controls" — an equipment or a retainer
lives on a **minion**, and only a location sits in the seat's own play
area. A count taken off `seat.permanents` would have seen the locations,
returned a smaller number, and looked exactly like a correct answer: the
`allEntries` lesson, in a tally rather than in a hook. The controller is
read off the entry too, since a master played on another Methuselah's
minion stays yours (p. 16).

The match is on the permanent **tags** (`equipment` / `location` /
`retainer`) that already answer this question elsewhere, not on the
registry: the tag travels with the entry wherever it sits, and the
resolution path has no registry to ask.

## §3 What it found: `if (hits.length === 0) continue;`

`refPerMinion` skipped any seat whose tally was zero. Correct for every
card it had ever carried — nothing times a rate is nothing — and **wrong
the moment a card prints a flat term**.

Treaty of Tyre Enforced is *"each Methuselah burns **X+1** pool, where X
is the number of Assamites he or she controls"*, and the whole point of
the card is the Methuselah with **no** Banu Haqim paying 1 anyway. With
the guard in place the card would have billed only the seats that deserved
it, which is the opposite of what it says and reads as sensible behaviour
in a log.

Same shape as Can't Take it with You's "each Methuselah gains 1 pool"
half, which likewise has to reach a seat holding nothing. Both are now
paid outside the tally, and the early return survives only where there is
no flat term either.

**The lesson:** *an early return that means "nothing to do" stops being
true the day the effect gains a term that does not depend on the count.*
The tell is a card whose sentence has a constant in it.

## §4 `oncePerGameByName` is a query, not a latch

*"Only one Political Stranglehold can be played or called in a game."*

`oncePerTurnByName` exists and records on the turn frame, because a turn
frame is a thing that goes away. A GAME-scoped bar has nothing to reset,
so it is a query over the event log — *has a `CardPlayed` with this name
ever fired* — and there is no field to clear at a phase boundary, none to
forget to serialize into a save, and no difference between "played" and
"called" to keep straight.

The event-log query is the same shape the engine already uses for
`hasLimitedBleedIncrease` and for game-wide ally uniqueness.

## §5 The clan trap again

Treaty of Tyre Enforced prints *"the number of **Assamites** he or she
controls"*. The registry clan is **Banu Haqim** — the second wave running
to hit this (wave 59, Khabar: Loyalty). It is now reliably the first thing
to check on any legacy card that names a clan in its text rather than in
its icon.

## §6 Tests

`tests/cards/table-pool-swings.test.ts`, 5 cases:

- Treaty bills a Methuselah with **zero** Banu Haqim (§3), and bills the
  one with two for 3;
- Political Stranglehold pays 3 per capacity-8 vampire, ignores a 7, and
  **is not offered a second time** in the same game;
- Can't Take it with You counts a weapon and a retainer **on a minion**
  alongside a location in play (§2), and leaves a seat holding nothing
  1 pool ahead;
- Mark of the Damned bills from the **prey's** heap and counts only the
  entries flagged `crypt`, not the library card beside them;
- a control: the fixture's own vampires are not Banu Haqim, so the Treaty
  assertion is not passing by accident.

## §7 Left behind

**Finding the Path** (choose at least half the Methuselahs — a terms
enumeration over subsets, a different card), **Honor the Elders** (the
same shape in BLOOD, and it reaches uncontrolled regions), **Justicar
Retribution** (burns by current bleed — a derived trait read at
resolution) and **Might of the Camarilla** (each Methuselah CHOOSES a
vampire to burn — a choice frame per seat). All four are the next wave in
this vein and none of them shares this primitive.
