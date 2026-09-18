# Events that are one table-wide rule

Tranche 3, wave 34. Library **618 → 621**. The **non-Gehenna** events: one
sentence each, no trigger, no counters, no requirement — each just changes
a rule everyone plays under, for as long as it is in play.

| Card | KRCG | Printed |
|---|---:|---|
| Port Authority | 101420 | Government. When a Methuselah uses a **discard phase action** to discard a card, they don't draw to replace that card **until their next unlock phase**. |
| NRA PAC | 101305 | Government. Any minion who successfully performs an **equip** action **unlocks at the end of the turn**. |
| Urban Jungle | 102085 | Inconnu. **Blood hunt referendums** get an additional **2 votes against** the referendum. |

All three sit in one Methuselah's play area and rule the whole table, so
each is read from every seat's permanents and none of them asks who its
controller is. The tests put each card in a seat that is **not** the one it
affects, because an owner-relative read would pass a test that put it in
the obvious place.

## §1 — Port Authority, and where the deferred draw actually lands

The card needs nothing new: `seat.delayedDraws` has held "do not replace
until your next unlock phase" since the first card that said it. The only
question was *which* discard it catches, and `discardCard`'s `replace`
flag already answers it — a **discard-down to hand size** passes false and
is not a play at all (p. 7), while a **discard phase action** passes true.
That is exactly the distinction the card draws.

What it did change is the ORDER. *"The cards are replaced **before**
unlocking cards: other unlock effects cannot be ordered before"*
[ANK 20200129] [LSJ 20091208]. The drain ran at the **end** of the unlock
sweep, after the unlock loop and after every `onAnyUnlock` hook. Nothing in
the pool could tell the difference today — no unlock effect reads the hand
— so this is a correctness fix with no visible consequence, moved because
the ruling is explicit and the card that makes it matter will arrive
without warning.

## §2 — A promise that outlives the card that made it

*"Any minion who successfully performs an equip action unlocks at the end
of the turn."* Two rulings pin both edges, and they pull in opposite
directions:

- *"Does not affect equip actions performed **prior to** its arrival in
  play"* [LSJ 20061218].
- *"The minions who performed an equip action **when it was in play**
  unlock at the end of turn **regardless of whether NRA PAC is still in
  play or not**"* [LSJ 20080619].

Together they say the card is read **when the equip succeeds** and never
again. So the flag lives on the **minion** (`unlocksAtEndOfTurn`), set in
`enterPermanentFromAction` where the equip has actually succeeded, and
`endTurn` honours it without looking for the card. A static read at end of
turn instead would have got both rulings backwards at once.

The unlock still respects `unlockSuppressed` — a minion held down by a
card in play does not unlock here either, the same guard the unlock phase
uses.

## §3 — Votes nobody casts

*"Blood hunt referendums get an additional 2 votes against."* The engine
already distinguishes a blood hunt from a political action
(`ReferendumFrame.variant`), because a blood hunt has no calling card and
no terms. The 2 votes are added **in the tally**, not cast as a ballot by a
seat: nobody owns them, so nothing that reads, redirects or cancels a
ballot can touch them, and the caller-breaks-ties arithmetic is untouched.

## What the wave found

**Nothing broken — and that is the finding.** Three cards, three
subsystems (the replacement draw, the unlock sweep, the referendum tally),
and each one already had the hook, the flag or the discriminant the card
needed. The only engine change with teeth is the §1 reordering, which is a
ruling being honoured rather than a bug being fixed.

That is worth recording precisely because it is unusual: every wave since
11 has found at least one defect, and this one's cards are the first in a
while that are *simple* rather than novel. A wave that finds nothing is
evidence the primitives have caught up with the bucket — not evidence the
wave was too easy to bother with.

Two guards did fire, and both were right to. `library-audit.test.ts`
refused three cards named by no test and no fuzz deck; `render.test.ts`
refused **Government** and **Inconnu** as printed keywords the in-app
rules never explain.

## What is left

28 events. The remaining non-Gehenna ones (Dr. Marisa Fletcher, FBI
Special Affairs Division, NSA Trio, The Uncoiling, Inconnu Tutelage) each
carry counters or a granted action, so they are a wave rather than a
footnote. **Blood Cult Awareness Network is inert by §0** — it requires a
ready imbued, and the pool has none.

## Tests

`tests/cards/table-rule-events.test.ts`, 3 tests. Urban Jungle's is the
negative one: the same fixture as a **political** referendum gains
nothing, so the +2 is pinned to the blood hunt rather than to voting.
