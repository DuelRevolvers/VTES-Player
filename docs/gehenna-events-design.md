# Gehenna: the recurring event

Tranche 3, wave 32. Library **612 → 615**. Wave 31 built the Event card
TYPE; this is the family that type exists for — **one card, in one
Methuselah's play area, that fires in EVERY Methuselah's phase, for that
Methuselah**.

| Card | KRCG | Printed |
|---|---:|---|
| Dragonbound | 100581 | Gehenna. Do not replace **as long as this card is in play**. During each Methuselah's **discard phase**, that Methuselah burns 1 pool for each vampire in torpor they control. |
| Thirst | 101974 | Gehenna. **After each Methuselah's minion phase ends**, each ready vampire controlled by that Methuselah with **capacity less than the number of Gehenna events in play** who did not hunt during that minion phase burns 1 blood. |
| Conquest of Humanity | 100409 | Gehenna. **Requires 2 or more other Gehenna events in play.** Do not replace until your next discard phase. During each Methuselah's **unlock phase**, that Methuselah can choose a location controlled by their prey. The chosen location is **burned unless its controller burns 2 pool**. |

## §1 — "Gehenna" is a printed keyword that counts itself

Two of the three read the keyword, and they read it in different
directions:

- **Conquest of Humanity gates on it**: *"requires 2 or more OTHER
  Gehenna events in play"*. "Other" is free — the card is not in play
  when the requirement is asked, so everything counted is another.
- **Thirst measures with it**: the waterline is *"the number of Gehenna
  events in play"*, and that count **includes Thirst itself**. A lone
  Thirst therefore bites nothing (no vampire has capacity < 1); each
  further Gehenna event raises the waterline by one. That is not a
  degenerate case to code around — it is the card's clock.

The keyword is a **printed tag**, so the count is a tag count over every
seat's permanents. `gehennaEventsInPlay` is the one helper both use, for
the "one question asked in two places will drift" reason.

**The gate is checked only when the card is PLAYED.** *"The 'other
Gehenna cards in play' requirement is only checked when playing the
card"* [PIB 20121031] — so it lives in `compileEventCard`'s option
enumerator and nothing re-checks it. Burn the other events afterwards and
Conquest of Humanity stays in play, working.

§0 check before building: the requirement needs **three** Gehenna events
on the table at once, and this wave puts exactly three in the pool. Any
fewer and Conquest of Humanity would have been unplayable — inert, not
partial, and out by §0 either way.

## §2 — The subject is the phase's seat, never the owner

`onAnyUnlock`, `onDiscardPhase` and the new `onMinionPhaseEnd` all hand
the hook **the seat whose phase it is**. These three cards ignore `owner`
completely: Dragonbound sitting in Carol's play area still burns *Alice's*
pool during *Alice's* discard phase, and the test puts it there deliberately
rather than in the acting seat's, because "each Methuselah's" is the whole
point and an owner-relative read would pass a test that put it in the
obvious place.

**`onMinionPhaseEnd` is new, and it is the only one of the four siblings
that fires as a phase CLOSES** rather than opens — which is exactly why
Thirst needs it: *"who did not hunt during that minion phase"* is a
question you can only ask once the phase is over.

The latch it reads is set at **announcement**, not at success: *"the hunt
need not be successful for a vampire to avoid the effect"*
[LSJ 20050727]. `MinionState.huntedThisPhase` goes on beside the
`inherentStealth` line that already distinguishes a hunt, and resets with
`bledThisTurn` and the rest at the controller's unlock phase.

## §3 — A replacement draw that waits on nothing schedulable

`delayedReplace` had four values and every one of them names something
the engine already reaches: an unlock phase, a discard phase, the end of
an action, the end of a combat. **"Do not replace as long as this card is
in play"** names none of those. It waits on the card **leaving play**,
which is not a phase, has no frame, and may never happen at all.

So it cannot be a counter on the seat the way `delayedDraws` is — the
engine would have nothing to count down. `GameState.drawWhenLeavesPlay`
holds `{seat, cardId}` pairs instead, and `burnPermanent` releases the
matching ones. Keyed by card, because *which* card is the only thing that
tells you the wait is over.

**Known gap, recorded rather than guessed at:** an event *cancelled as it
is played* never enters play, so it never leaves, so its replacement
would wait forever. Nothing in the pool can cancel an event (an event is
not a master card, and the cancel-as-played cards in the pool name master
cards), so this is unreachable today. It becomes real the day a card
cancels an event, and this is the paragraph to come back to.

## §4 — Two seats, two questions, one clause

Conquest of Humanity is the only one that asks anything. *"That Methuselah
**can** choose a location controlled by their prey"* is optional and
belongs to the phase's seat; *"burned **unless its controller** burns 2
pool"* is mandatory and belongs to somebody else. Two `raiseChoice`
frames, addressed to two different seats, chained by the first's
`applyChoice`.

Both frames re-check that the location is **still in play** before acting
on it. The gap between the two questions is a gap in which anything can
happen, and a read that assumes otherwise is the "a derived read must be
TOTAL" lesson wearing a different hat.

The pay arm needs pool to **spare** (`pool > ransom`, not `>=`): nobody
may oust themselves to keep a location. The burn arm is unconditional,
which is what keeps the frame answerable when they cannot pay.

## What the wave found

**The rules screen is part of the pool's vocabulary, and it caught this
one.** `render.test.ts` asserts that every printed sub-type and keyword
in the registry is explained somewhere in the in-app rules; "Gehenna"
arrived as a printed keyword nothing in the rules text mentioned, and the
test failed. Worth noting that wave 31 got away without an **Event**
entry in the card-type list purely because the word "event" happens to
appear in the log section's prose — the detector is a substring match, so
it can pass for the wrong reason. Both are now written properly.

**Wave 32's cards are in the fuzz decks; waves 27–31's are not.** Step 5
of the wave ritual was missed for five consecutive waves — the deck list
in `tests/engine/fuzz.test.ts` ends at wave 26's retainers. Nothing is
broken by it, but fifteen cards have never been dealt into a random game.
Flagged for the owner rather than fixed here: adding them reshuffles every
seeded game at once, which is its own wave's worth of work (and, by this
project's own lesson, usually finds something).

## What is left

34 events. The rest of the Gehenna family mostly follows one of the three
shapes proved here — a recurring per-Methuselah trigger, a global static
tax, or a delayed replacement keyed on some game event ("until a vampire
commits diablerie", "until a Methuselah is ousted"). That third one wants
the same treatment §3 gave "while in play": a condition, not a phase.

## Tests

`tests/cards/gehenna-events.test.ts`, 4 tests. One negative: Conquest of
Humanity is **not offered** with only one other Gehenna event in play, and
is with two — the same fixture twice, so the assertion cannot pass by the
card being unplayable for some unrelated reason.
