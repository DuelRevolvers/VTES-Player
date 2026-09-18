# One each round

Tranche 3, wave 44. Library **648 → 651**. Three combat cards whose first
sentence is the same sentence — *"a vampire can play only one X each
round"* — which is how a **recorded deviation** got closed.

| Card | KRCG | Printed |
|---|---:|---|
| Death Seeker | 100510 | One each round. **Cancel a combat card** played by the opposing minion as it is played; its cost is not paid. |
| Leathery Hide | 101082 | One each round. Prevent **four non-aggravated** damage from the opposing minion's strike. |
| High Ground | 100925 | One each round. Maneuver, **only to long range**. With **flight** the foe lacks, play before range to **set** the range to long. |

## §1 — The limit was per FRAME, and the data to fix it was already there

CLAUDE.md carried this under *Known deviations*:

> `spec.combatLimit` is per COMBAT FRAME where the printed limit is per
> VAMPIRE, so two combatants cannot each play their own copy in a round.

The gate read `cf.playedThisRound` / `cf.playedThisCombat`, which hold
**names only** and are frame-wide. One combatant playing a Leathery Hide
barred the other from playing theirs.

The fix cost four lines, because **`cf.playedHistory` has recorded
`{name, minion, round}` since wave 29** — added for Haymaker's *"not
usable if this minion played one LAST round"*, and explicitly documented
as *"the only record that survives the round reset"*. It sits immediately
beside the coarser lists, in the same function, and the limit gate never
looked at it.

That is *"one question asked in two places will drift"* in its purest
form: two records of the same fact, the newer one strictly better, and the
older one still wired to the gate. Worth adding to the standing lesson —
**when you add a richer record, re-point the readers of the poorer one**.
The deviation note is now deleted rather than reworded.

`playedThisRound` / `playedThisCombat` stay, because the per-MODE limit
(`modeCombatLimit`, "only one at superior each combat" — Terror Frenzy)
still uses them and `playedHistory` does not record modes. **That one is
still per frame**, and is now the only part of the deviation left; it is
recorded as such rather than quietly fixed halfway.

## §2 — Death Seeker: a cancel one condition wider

`cancelStrikeCard` already existed (Anticipation superior, The Vozhd of
Gravesend) and lives in the `card.asPlayed` window that p. 7 reserves for
cancels. Death Seeker is the same thing with the strike condition dropped:
any combat card the opposing minion plays. `CardPlayFrame.isCombat` is
already denormalized onto the frame for exactly this family, so no card
reads another card's spec.

Its six rulings are the interesting part, and **every one of them is
already the engine's behaviour**:

- *"If used to cancel a strike, another strike is chosen"*
  [LSJ 20100206] — the slot was never filled, so the settle loop asks
  again.
- *"The canceled card has still been played … the same reaction or
  modifier cannot be played again by the same minion"* [ANK 20190104] —
  `playedHistory` records the play, and `cancelPendingCard` does not
  unwind it.
- *"If a limited effect is canceled, the limit is not triggered"*
  [LSJ 20030224] — the limits are applied by the effects, which never ran.
- *"If the canceled card had a 'do not replace until' clause, that clause
  is canceled as well"* [LSJ 20080630] — the deferral is registered by the
  effect, likewise.

A card whose rulings all describe behaviour you already have is a good
sign about the shape of the window, and worth saying out loud: the
temptation with a list like that is to build four things.

## §3 — High Ground: setting is not maneuvering

Two modes at the same printed level, in two different windows.

The maneuver half needed `onlyToLong`, the plain mirror of the existing
`onlyToClose` (Dance with the Devil) — worth nothing once the range is
already long.

The flight half **sets** the range, which is a different act:
*"once the range is set, no other effect can be used to reset the range
that round"* and the Determine Range step is skipped [RTR 19970630]
[ANK 20180720] — which is what `setCombatRange` already does.

**And the flight test is not `minionHasTag`.** That helper reads the
minion's SELF-attached entry, so it answers *"what does this minion
PRINT"*. No vampire in the pool prints flight — the Gargoyles are not in
it — so flight only ever arrives **granted**, and the printed-only
question would have made the clause permanently dead: whole by the letter
of §0 and inert in fact. The gate reads any attached card carrying the
tag, which includes the self entry.

That is a small instance of a general trap worth naming: **a derived
helper's name says what it returns, not what your card is asking.**

## What the wave found

**A recorded deviation whose fix had been sitting in the same function
for fifteen waves**, and a helper that answers a nearly-right question
(`minionHasTag` → printed sub-types) where the card needs the granted
answer too.

Neither is a crash. Both are the "empty for the wrong reason" family: a
gate that is too strict and a filter that matches nothing, each of which
looks exactly like correct behaviour from the outside.

## What is left

30 T1 combat cards. Several are inert by §0 — **The Khabar: Honor** and
**Focus the Blood** (Assamite), **Raking Talons** (Gargoyle), **Neebi**
and **Three's a Crowd** (Laibon, Blood Brothers). The next buildable
cluster is the cards that put themselves in play as equipment mid-combat
(Molotov Cocktail, Zip Gun, Magazine).

## Tests

`tests/cards/one-each-round.test.ts`, 5 tests, two of them negative: the
same vampire cannot play a second copy this round, and no maneuver to long
once the range is long. The positive counterpart is the one that matters —
the OTHER vampire may still play theirs, which is the deviation.
