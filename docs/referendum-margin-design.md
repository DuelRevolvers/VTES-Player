# The after-referendum window, and the margin

*Voter Captivation (102131), Amici Noctis (102274), Magnetic Authority
(102331).*

## 1. The cluster

Three cards, all opening with the same line:

> Only usable after resolution of a political action whose referendum
> **passed**.

and two of the three paying out **per vote by which it passed**:

| Card | Needs the margin? | Effect |
|---|---|---|
| Voter Captivation `[pre]` | yes | this vampire gains 1 blood per vote of margin; `[PRE]` move up to 2 of them to your pool instead |
| Amici Noctis (Lasombra) | yes | distribute 1 blood per vote of margin among your ready Lasombra and your pool, at most 1 each, and at most 1 pool (2 if the acting Lasombra is titled) |
| Magnetic Authority `[dom]`/`[pot]` | no | add 2 blood to a Sabbat vampire in your uncontrolled region; `[DOM]`/`[POT]` add 1 to each |

They were deferred from the after-action-resolution wave
(`docs/after-resolution-design.md` §6) for exactly the two reasons this
doc closes: their window is after the **referendum**, not the action, and
the margin was not recorded anywhere.

## 2. The window

The same shape as `action.afterResolution`, one frame along.
`resolveReferendum` currently **pops first** and then emits the result and
applies the effects, so the frame is gone before anything can react to it.
The tally is now computed into the frame first:

```ts
rf.votesFor / rf.votesAgainst / rf.passed / rf.margin
```

and, **if the referendum passed** and some seat can actually play
something, `rf.step` becomes `"afterResolution"` and settle runs an
impulse cycle before the pop. When the cycle goes quiet,
`resolveReferendum` runs again, sees the tally is already recorded, skips
the window, and finishes exactly as before.

Two properties carried over deliberately from the action window:

- **It opens only when someone can use it** — the recorded deviation from
  `combat.damageResolution`, for the same reason (an unconditional impulse
  after every referendum would be a decision per seat per referendum).
- **The step must be set BEFORE probing**, because each card's usable rule
  asserts it is in the window. Asking first always answers "nobody". That
  cost an hour on the previous wave; it is the same trap here.

And one that is specific to this window: **it opens only on a pass.** All
three cards say "whose referendum passed", so a failed referendum never
opens it — which also keeps `forcedFail` (Yoruba Shrine) honest, since
that resolves as a failure rather than a cancellation.

## 3. The margin

**`ReferendumFrame.margin`** = `votesFor − votesAgainst`, recorded at the
tally. Nothing else in the engine needed it; the tally computed both
numbers and threw the difference away.

The new usable rule is **`afterReferendumPassed`**, and the effects that
read the number take it from the frame rather than recomputing, so a card
cannot disagree with the result that was announced.

## 4. Amici Noctis is an allocation with caps

> For each vote by which the referendum passed, distribute 1 blood from
> the blood bank among the ready Lasombra you control and your pool. A
> vampire cannot gain more than 1 blood this way. You cannot gain more
> than 1 pool this way **or more than 2 pool this way if this acting
> Lasombra is titled**.

Because every recipient is capped at 1 blood, an "allocation" here is just
**a subset of your ready Lasombra plus an amount of pool**, with

```
|chosen vampires| + pool ≤ margin,  pool ≤ (acting Lasombra titled ? 2 : 1)
```

so it enumerates as one option per legal (subset, pool) pair rather than
through `enumerateAllocations`, whose shape assumes uncapped recipients.
The subsets are bounded by how many ready Lasombra a Methuselah controls,
and by the margin.

**Reading on record:** "distribute" is not required to be exhausted. With
three Lasombra, a pool cap of 1 and a margin of 9 there is no legal way to
place all nine, so the card would be unplayable if the whole amount had to
land. Every distribution up to the margin is offered and the player
chooses — the legal-move-generator principle, and the same reading the
rulebook takes for a search ("searching can result in not finding the
card", p. 14).

## 5. Magnetic Authority needs no margin at all

It only needs the window. Both modes add blood to the **uncontrolled
region**, which `addUncontrolledBlood` / `UncontrolledBloodAdded` already
does (Fifth Tradition: Hospitality) — the work is enumerating the target
for the basic mode, since that primitive was built for action *cards* and
this is a modifier.

## 6. Rulebook citations

- p. 3 — the uncontrolled region.
- p. 27 — a successful political action calls its referendum; the terms
  are chosen only then.
- p. 28 — the polling step and the tally; ties fail.
- p. 35 — blood counters come from the blood bank.
