# Gehenna taxes

Tranche 3, wave 33. Library **615 → 618**. Wave 32 built the Gehenna event
that *does* something each phase; these three are the ones that just
**change the rules everyone plays under** — and whose replacement draw
waits on a **condition** rather than a phase.

| Card | KRCG | Printed |
|---|---:|---|
| Torpid Blood | 101994 | Gehenna. Do not replace **until a vampire moves from torpor to the ready region**. Actions performed by vampires in torpor cost +1 blood. Rescuing an **older** vampire from torpor costs +1 blood. |
| The Slow Withering | 101807 | Gehenna. **Requires 1 or more other Gehenna events in play.** Do not replace **until a vampire commits diablerie**. Cards requiring 1 or more Disciplines **at the superior level** cost +1 blood. Vampires who commit diablerie **ignore this effect until a Gehenna event is played**. |
| The Rising | 101640 | Gehenna. **Requires at least 2 other Gehenna events in play.** Do not replace **until your prey is ousted**. A Methuselah cannot gain pool during their own turn unless they have the Edge or at least 1 victory point (instead, any pool they would gain goes to the blood bank). |

## §1 — A replacement draw that waits for an EVENT

`delayedReplace`'s five values all name something the engine reaches on a
schedule: an unlock phase, a discard phase, the end of an action, the end
of a combat, and (wave 32) the card leaving play. These three name none of
them — they wait for **something to happen at the table**, and it may
never happen at all.

`delayedReplaceUntil` takes the condition, `GameState.drawWhenCondition`
holds `{seat, until}`, and `releaseConditionalDraws` fires from **inside
`emit`**, at the one point every event passes through. It runs *before*
the event is applied, because *"until your PREY is ousted"* has to read
the seating ring **as it was when the oust happened** — apply the oust
first and the ring closes up, and the seat you were asking about is
somebody else's prey.

It is held on the GAME rather than on the card, because *"is not replaced
until the condition is met, **even if it is burned**"* [LSJ 20080805].

## §2 — A tax on the LEVEL, and a vampire who is excused from it

*"Cards requiring 1 or more Disciplines at the superior level"* is not a
property of the card — it is a property of the **mode being played**.
`PricedCard.requires` already answers *which* Disciplines; the new
`requiresSuperior` answers *at what level*, off a `requiresSuperiorDiscipline`
compiled centrally beside `requiresDisciplines`. A card with a superior
printing pays nothing while its basic mode is chosen, which is the whole
point of asking the mode.

*"Vampires who commit diablerie ignore this effect until a Gehenna event
is played"* is an exemption on the **minion** (`ignoresGehennaTax`), set
at the `DiablerieCommitted` chokepoint and cleared for every minion the
next time **any** Gehenna event is played — whoever plays it, whatever it
does. It is read in `playCostFor`, not in `playCostModApplies`, because
the latter only ever sees the card and this question is about the payer.

## §3 — Dropping an event instead of applying it as zero

The Rising's *"instead, any pool they would gain goes to the blood bank"*
has an easy wrong implementation: let `PoolGained` be emitted and add
nothing when applying it. The blood bank is unmodelled and infinite, so
the table would look right — and **the fuzz proves pool conservation by
replaying the event log**, where a logged gain that never landed makes the
replay disagree with the table.

So the bar sits at the top of `emit` and drops the event entirely. No
event, no gain, and the log stays a true account of the game. The same
method reads **every** seat's permanents: one Methuselah's card rules the
whole table.

## §4 — Two prices, asked twice each

Torpid Blood's two clauses are both prices, and each is read at an option
gate **and** where the cost is actually paid — the `rescueDiscountFor`
lesson (docs/play-cost-design.md §3), where a discount unreachable at
enumeration is a discount that does not exist, and a surcharge missing
there lets a minion announce what it cannot pay. `tableStatic` is the one
helper both sites call.

Leave-torpor pays its whole cost at **resolution** (p. 24), so the tax
rides with it there and the option gate asks for `2 + tax`. Any other
action a card might let a torpid vampire take pays at announcement, like
its printed cost. "Older" is greater capacity, and the **rescuer** pays
the extra.

## What the wave found

**Narrow Minds shipped broken in wave 31.** `delayedReplace` was wired in
`compileCombatCard` and `compileModifierOrReaction` — and nowhere else.
Narrow Minds is an **event**, compiled through `compileMasterCard`, which
never read the field, so its *"do not replace until your next unlock
phase"* did nothing: the card was replaced immediately, every time. It was
a partial card in the pool and `no-partial-cards.test.ts` could not see it,
because that test asserts the spec is complete, not that the compiler
reads every field of it.

This is "one question asked in two places will drift" with the twist that
makes it worse: asked in two places, it was **not asked in a third**, and
adding a card type is exactly when that happens. The clause is now wired
once, centrally in `compileSpec`, where every card type passes.

The regression test is a direct read of the compiled handler rather than a
game trace — the defect was a field never copied, so the assertion that
catches it is the one that names the field.

## What is left

31 events. The remaining conditions follow the same shape ("until a
Methuselah is ousted", "until a vampire successfully hunts", "until a
titled vampire goes to torpor"), so they are `DelayedDrawCondition` cases
and nothing more.

## Tests

`tests/cards/gehenna-taxes.test.ts`, 5 tests. Two negatives: the
leave-torpor option **disappears** at 2 blood and returns at 3, and an
oust of the **predator** does not release a draw waiting on the prey.
