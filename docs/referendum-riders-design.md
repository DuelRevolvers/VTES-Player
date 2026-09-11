# Referendum outcome riders — cards that wait for the result

*Elder Kindred Network (100619), Bribes (100251), Malkavian Rider Clause
(101156), Cryptic Rider (100478).*

Wave 21, landed **v0.10.4**. Library **575 → 579**.

Four cards played while a referendum is live whose effect does not happen
until the votes are counted:

> "If the referendum **fails**, the Methuselah calling the referendum
> burns 1 pool plus 1 additional pool **for each vote difference**."

## 1. What existed, and the half that did not

`ReferendumFrame.postTally` was built for Scorn of Adonis and is
documented as *"effects that outlive the tally, applied after
`ReferendumResolved` **whatever the outcome**"*. That last clause is the
gap: Scorn does not care which way the vote went, so nothing in the
mechanism could ask — and nothing read `margin` there either, though the
field had been on the frame since the referendum-margin wave.

So the union grew three members, and the firing loop grew the two
questions it had never been asked:

| rider | fires | reads |
|---|---|---|
| `burnPoolVotedAgainst` (Scorn) | always | who voted against |
| `burnCallerOnFail` | **on a fail** | `margin` |
| `payVotedForOnly` | always | every seat's ballots, both directions |
| `autoPassNextOnPass` | **on a pass** | — |

**The margin's sign is the "vote difference".** `margin` is
`votesFor − votesAgainst`, so a failed referendum's is zero or negative
and the difference is its magnitude. A **tie fails with a margin of 0**
(p. 28), which makes Elder Kindred Network cost the caller its base pool
and nothing more — the cheapest possible failure, and the case a
`margin > 0` guard would have got wrong in the other direction.

## 2. Bribes: two moments on one card

> "**Gain 1 pool.** Any other Methuselah who casts one or more votes or
> ballots in favor of and does not cast votes or ballots against the
> referendum gains 1 pool when the results of the referendum are tallied."

The first sentence is immediate; the second cannot be known until the
polling step is over. Both halves are **per SEAT**, not per ballot: a
Methuselah who voted both ways is paid nothing, however many votes they
put in favour, and one who voted in favour twice is paid once.

This surfaced a small trap in the compiler. The polling-step branch
handles its own effects and `return`s, so `gainPool` sitting in the same
mode was **silently skipped** — the card registered its rider and paid
nobody. The test caught it on the first run because it asserts the
immediate gain separately from the tally, which is the only reason it was
visible at all: the rider worked perfectly.

## 3. The auto-pass grant, and a card's rule living in the engine

Two of the four say "the next referendum a vampire you control calls
passes automatically". The engine already had `SeatState.autoPassReferendum`
for Día de los Muertos — as a **boolean**, with that card's condition
written into the consumption site:

```ts
if (callerSeat.autoPassReferendum && caller?.sect === "sabbat") { … }
```

Día de los Muertos says "a **Sabbat** vampire you control"; the two new
cards say "a vampire you control" and name no sect. With the sect test in
the engine, neither could ever fire. The engine was holding one card's
rule on behalf of all of them.

The flag is now a **record carrying the granting card's own conditions** —
`{ sect?, thisTurnOnly? }` — and the consumption site only asks whether
they are met:

| card | grant |
|---|---|
| Día de los Muertos | `{ sect: "sabbat", thisTurnOnly: true }` |
| Cryptic Rider | `{ thisTurnOnly: true }` |
| Malkavian Rider Clause | `{}` |

The third is not an oversight. Malkavian Rider Clause does **not** say
"this turn", so the grant waits however long it takes, and `TurnBegan`
now clears only the grants that say otherwise.

### Two kinds, one op

Malkavian Rider Clause is played during **polling** and has to wait for
the tally; Cryptic Rider is played in the **after-resolution window** of
a referendum that has already passed, so its grant is immediate. Same
grant, two moments.

They are two effect kinds rather than one with a flag because
`POLLING_ONLY_EFFECTS` keys on the kind — that set exists precisely
because the same bug was written three times, and one kind legal in two
different windows would have made it unanswerable. They share the one op.

Cryptic Rider's "only usable **on a successful referendum**" needs no
test at all: that window only opens on a pass, so the window *is* the
condition.

## 4. Tests

`tests/cards/referendum-riders.test.ts`, 7 tests — the whole content is
"does it fire, and on which outcome", so each rider is asserted both ways:

- Elder Kindred Network burns the caller **3** on a 2-vote failure, and a
  **control** — the same game without the card — shows a passing
  referendum costs the caller nothing extra;
- Bribes' immediate pool, then Carol paid (voted for only), Bob not
  (voted against), Alice not (she is not an "other Methuselah");
- Malkavian Rider Clause arms **the seat that played it**, not the
  caller, and arms **nothing** when the referendum fails;
- Cryptic Rider arms `{ thisTurnOnly: true }` from the after-resolution
  window;
- Día de los Muertos still produces its own `{ sect, thisTurnOnly }` —
  the card that used to own those clauses, pinned where they now live.

The control in the second test is there because Anarchist Uprising charges
the caller when it passes, so "no pool was burned" is not assertable in
that fixture. Comparing two runs is.

Fuzz: all four dealt in beside the existing political actions. Green.

## 5. Not done

- **Poison Pill** (101406) — "if the referendum passes **and the effect of
  the referendum causes you to lose pool**, the controller of the acting
  vampire loses the same amount". It needs pool loss *attributable to the
  referendum's own effect*, which nothing tracks; a rider would have to
  watch the resolution rather than the result.
- **Political Backlash** (101413) — "only usable when a referendum
  **fails**". The after-resolution window opens **only on a pass**
  (`rf.passed === true`), so a failed referendum offers no impulse at all
  and this card has nowhere to be played. Widening that gate is a small
  change; what is not small is that the existing branch is scoped to the
  CALLER (it enumerates action modifiers played by the vampire who called
  the vote), and Political Backlash is a reaction any Methuselah may play
  — which lands in reaction timing, wakes and state A. A wave of its own.
- **Aura of Invincibility** (100112) — a permanent with counters that
  sends its bearer to torpor on a failure. The rider is this wave's; the
  card is not.
