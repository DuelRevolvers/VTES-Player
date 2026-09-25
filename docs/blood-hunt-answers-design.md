# The blood hunt — design (wave 89)

Three legacy cards on **one referendum**. The blood hunt (p. 35) was engine-only:
the diablerie's fifth step pushed it, the table voted, and a pass burned the
diablerist with nothing anybody could do about it. These are the first cards in
the pool that reach into it.

| Card | KRCG | Cost | Text |
| --- | --- | --- | --- |
| The Hunt Club | 100946 | — | Unique Master. Put this card on any ready vampire. This vampire gets +1 stealth when attempting to commit diablerie. This vampire may not cast votes or ballots during a referendum to call a blood hunt on this vampire. |
| Absolution of the Diabolist | 100012 | 1 pool | Master: out-of-turn. Requires a ready justicar or Inner Circle member. This card is playable during your minion phase. Only usable when a vampire is about to be burned by a blood hunt. Cancel that blood hunt. |
| Lay Low | 101075 | 1 blood | Requires an anarch. Only usable when a blood hunt referendum passes and would burn this anarch. Move this anarch to the uncontrolled region (breaking any temporary control effects). Any cards and counters on this vampire remain with him or her (but are out of play as long as the vampire remains uncontrolled). |

Printed text read from `data/vtes-raw.json`.

**One card tilts the vote; two answer the verdict.** All three meet at the single
line where a passed blood hunt burns its target, which is what makes them a wave
rather than three one-offs.

## 1. "About to be burned" is a moment the engine already had

Both answers need to act after the tally and before the burn. That is exactly
the `referendum.afterResolution` step: on a pass, it is entered *before* the
effect is applied, and it opens only when some seat can actually use it. No new
window, no new sequencing.

What it could not do was offer these cards. The one usability rule that reaches
that window, `afterReferendumPassed`, is written for the caller's own payout
(Voter Captivation) and requires `ctx.seat === rf.caller` and a non-null
`rf.callingMinion`. **A blood hunt has no calling card and no calling minion, and
its "caller" is the victim's own controller** — the seat the rule would hand the
option to is the one being burned, for a reason that has nothing to do with these
cards. So both are bespoke handlers with their own `options`, sitting beside
Sudden Reversal for the same stated reason: their window fits no spec shape.

## 2. Cancel, and the guard that was already there

- **Absolution** calls `ops.cancelBloodHunt()`, which sets
  `ReferendumFrame.bloodHuntCanceled`. The pass path returns before the burn.
  The referendum still *passed* — only the burn is called off, which is what the
  card says and what anything watching a passed referendum should still see.
- **Lay Low** needed nothing new at all. The burn was already guarded by "if
  still in play (a mid-referendum effect could have removed them)", and an anarch
  in the uncontrolled region is not in any seat's `minions`. Lay Low is the first
  card to use that guard, and the comment above it had been describing a
  hypothetical for a year.

Everything Lay Low's parentheses promise is also already true: `MovedToUncontrolled`
turns blood into counters, keeps attached cards with the vampire and out of play,
and lands it in its **owner's** region — which *is* "breaking any temporary
control effects". The sixth parenthetical this project has met that describes
existing rules rather than asking for new behaviour.

**Two gates on Absolution worth stating.** Its out-of-turn master budget is the
ordinary one (p. 8: it costs the next master phase, even if the card is
cancelled), and it is taken centrally. But it is deliberately **not** given
Sudden Reversal's "another Methuselah's turn only" gate: "this card is playable
during your minion phase" is the card buying itself out of exactly that
restriction. And "requires a ready justicar or Inner Circle member" is about who
can grant absolution, never about the vampire being burned — so a seat with a
torpid justicar is not offered it.

## 3. The Hunt Club: a vote bar with a scope

`cannotCastVotes` already existed (Detection) and is read unconditionally where
vote sources are enumerated. The Hunt Club's bar is live in exactly **one**
referendum — the blood hunt about its own bearer — so it is a separate static,
`cannotCastVotesInOwnBloodHunt`, read at the same site, where the referendum
frame is in hand. It is never folded into a vote count: a count cannot ask which
referendum it is being asked about.

Its other clause needed nothing: "+1 stealth when attempting to commit diablerie"
is the existing `ConditionalStatic` with `actionKinds: ["diablerize"]`, the same
one Depravity uses. **Conditionals live inside `statics`, not beside it** — the
first draft put a `conditional` key on `permanent` and broke type inference for
three hundred unrelated card specs, which is what a misplaced key in a big
discriminated union looks like from the compiler's end.

The card goes on **any** ready vampire, so it is as much a weapon to hand an
opponent's diablerist as a gift to your own.

## 4. What the wave found

No engine defect this time — the honest answer, and the reason is worth keeping:
**this wave's mechanism had already been written defensively.** The
after-resolution step, the "if still in play" guard and the central out-of-turn
master debt were all built for cases nobody had yet written a card for, and all
three held. What the wave cost instead was two pieces of **metadata** the
compiler cannot check:

- **The registry's name is not the card's printed name.** KRCG prints "Hunt Club,
  The"; the registry normalises it to "The Hunt Club", and `supported.test.ts`
  is what catches a spec named the other way. The sibling of the clan-name lesson
  ("Assamite" vs "Banu Haqim"): a name copied from the card text matches nothing.
- **A bespoke handler must declare its printed types.** `costTypes` is not
  decoration: a card that answers no type is invisible to every play-cost
  modifier and to every card that filters by type, and
  `central-queries.test.ts` enforces it. Lay Low prints "Action Modifier /
  Combat" even though it acts in a referendum window, and it has to say so.

## 5. Tests

`tests/cards/blood-hunt-answers.test.ts` — 13 cases, every one driving a **real
diablerie** rather than hand-building a referendum frame: the blood hunt is part
of the diablerie's own resolution, and a fixture that pushes its own frame proves
nothing about whether the engine ever gets there.

The fixture gives Carol's vampire a **title**, because with no votes at the table
the hunt would tie, a tie fails (p. 28), and every one of these cards would look
like it worked. The first case is therefore the **control**: an unanswered hunt
passes and burns the diablerist.

Negative space: Lay Low refused to a non-anarch diablerist and refused to a seat
that does not control the victim; Absolution refused with no justicar, refused
with a *torpid* justicar, and accepted an Inner Circle member; The Hunt Club's
bar checked against the same prince voting freely without the card, and against
the card sitting on somebody else's vampire during this hunt.

Mutation-checked: the cancel flag (fails the two Absolution cases) and the vote
bar (fails exactly one Hunt Club case), each clean on restore.

Fuzz: all three added. The fuzz diablerizes, so the blood hunt is one of the few
referendums it reaches unaided — and Lay Low is its first mid-referendum move to
the uncontrolled region, which the pool/blood conservation replay has to agree
with.

## 6. Deferred, with the blocker named

**Veles' Hunt (102099)** belongs to this family — a political action that *calls*
a blood hunt referendum on the prey's ally or younger untitled vampire, which
would make these three reachable without anyone diablerising. It is not built
because of its last sentence: "if this referendum fails or is canceled, no more
Veles' Hunts can be played this game" is a **game-scoped latch conditional on a
failure**, and the existing `oncePerGameByName` is a query over `CardPlayed`
events, which cannot see how a referendum went. Building it means either
recording the failure as a fact in the log or giving the table a flag. Also
needed: a `ref*` primitive that sets `variant: "bloodHunt"` on a card-called
referendum, which in turn means the auto-burn branch must stop assuming "blood
hunt ⇒ no calling card".

## 7. Counts

Library 824 / crypt 217 / total 1041; supported 923 / 1041.
