# Events that keep a counter

Tranche 3, wave 35. Library **621 → 624**. The events with a **clock**:
counters that run up to a threshold, up to a self-burn, or down from a
starting pile.

| Card | KRCG | Printed |
|---|---:|---|
| Dr. Marisa Fletcher, CDC | 100577 | Government. During your unlock phase, add **two counters** to this card from the blood bank. When a vampire **with capacity less than X** is **blocked while hunting**, where X is the number of counters on this card, **burn that vampire and all the counters** on this card. |
| FBI Special Affairs Division | 100709 | Government. If an **ally is burned in combat** with an acting vampire, add 1 counter to this card and inflict **2 unpreventable environmental damage on the acting vampire after the combat ends**. If this card has **4 counters, burn it**. |
| Fueled by Heart's Blood | 100796 | Gehenna. Do not replace until a vampire commits diablerie. This card **comes into play with 10 counters**. After **another Gehenna event is played**, burn 1 counter. **Blood hunts cannot be called** on vampires with capacity greater than the number of counters who diablerize a **younger** vampire. |

Three directions on one mechanism: Fletcher's clock **rises** and resets to
zero when it fires, the FBI's **rises and kills the card**, and Fueled by
Heart's Blood's **falls** — and its falling count makes the shield it
grants *wider* as the game goes on, not narrower.

## §1 — Clocks that other cards wind

Two pieces were missing and both are statics rather than hooks, because
the question is always "does any card in play say this?" and never "whose
card is it?":

- **`startsWithCounters`** — *"comes into play with 10 counters"*, applied
  in `notifyEnterPlay`, the one site both entry paths already share, and
  **before** the card's own `onEnterPlay` so a clause that reads its
  counters on arrival sees them.
- **`burnCounterOnGehennaEvent`** — *"after ANOTHER Gehenna event is
  played"*, hung on the event-play site wave 33 already built for clearing
  diablerist exemptions. "Another" costs nothing: the card being played is
  not in play yet, so every counter-holder it finds is another card.

The blood-hunt shield reads **this entry's counters** rather than a fixed
number, which is what makes `barsBloodHuntAboveCounters` a static that
names a clock. It is checked in `commitDiablerie` at the one place the
hunt is pushed, using the victim's capacity **captured before the burn** —
it is already captured there for step 4.

## §2 — A triggered effect of a successful block

*"When a vampire … is blocked while hunting"* is a triggered effect of a
**successful block**, which is why it sits beside the block tolls rather
than in the combat that follows: *"if the action is blocked, all effects
that would be triggered by a successful block must be applied"*
[ANK 20220116]. The engine does not model the acting Methuselah's ordering
of several such triggers — nothing in the pool has two.

`capacity less than X` is read with `capacityOf`, so a granted +1 capacity
really does lift a vampire out of range, and `>=` is the whole test: a
capacity-5 vampire is safe at exactly 5 counters.

## §3 — Damage that lands after the fight it came from

*"…after the combat ends"* is queued on the combat frame
(`damageAfterCombat`) and drained at the engine's **one** `CombatEnded`
site — the `drawAfterCombat` treatment, and for the same reason recorded
there: a combat ends four different ways, and anything scoped to a live
frame that must be flushed at all of them will one day miss one.

Two of the FBI's three rulings fall out of reading the **frame** rather
than needing code:

- *"Does not trigger if the ally is considered the acting minion"*
  [ANK 20180913-2] — the check is `cf.opposing === leaver`.
- *"Does trigger if the ally burns by himself at the end of combat"*
  [LSJ 20100527] — the trigger asks about the **burn**, not about damage.

It hangs on `notifyLeaveReady`, which fires **before** the minion is
removed. That is the only moment the leaver can still be read, and reading
it is the only way to know it was an ally.

## What the wave found

**Burning the acting minion from inside a successful block threw.**
`resolveBlockAttempt` pushes a combat the moment a block succeeds, and
`pushCombat` reads both combatants with `getMinion`. Fletcher removes the
actor a few lines earlier — so the first time the card fired, the game
died with `unknown minion: V1` rather than resolving.

This is the *"a strike is CHOSEN in one window and RESOLVED in another,
and a combatant can leave the table in between"* lesson, one step earlier
in the sequence: a block succeeds in one breath and starts a combat in the
next, and the pool now contains something that acts between them. The fix
is the same shape as the guard already sitting a few lines above for a
**blocker** that has left play — that one was written as defence in depth
for a case the engine could not reach. This one it could.

A second, smaller trap was in the test rather than the engine: a walker
left running past the block kept playing into later turns, where
Fletcher's +2-per-unlock clock had climbed past the negative case's
threshold and burned the vampire that was supposed to survive. The
negative test was failing for the right reason at the wrong time. Walkers
against a card with a clock need a stop condition, not just a step cap.

## What is left

25 events. **Wormwood is deferred**: its *"vampires with capacity greater
than X are considered vampires with capacity X"* is a cap on `capacityOf`,
which takes only a minion and has no way to read the table — threading
state through every call site is its own piece of work, not a footnote to
this one. **Waiting Game** is out for a different reason: *"becomes
Camarilla"* is a sect change, which is a recorded out-of-scope.

## Tests

`tests/cards/counter-clock-events.test.ts`, 4 tests. The negative one is
the pair: capacity 5 against 6 counters burns, against 5 counters does
not, from the same fixture.
