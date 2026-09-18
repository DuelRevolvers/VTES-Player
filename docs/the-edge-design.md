# The Edge as a currency

Tranche 1 wave 57, 2026-09-16 (v0.10.48). Esteem (100664), Leverage
(101098), Instability (100993), Regaining the Upper Hand (101583).
Library 693 → 697.

## §1 One token, four relationships to it

The Edge has been in the engine since the kernel: `state.edge` is a
`SeatId | null`, `EdgeTaken` and `EdgeBurned` move it, and p. 21's rule —
a successful bleed of 1 or more gives the bleeder the Edge — has been in
`finishAction` all along. Until now **nothing in the pool touched it**
except the turn's optional 1 pool and Kalinda's `unlockForEdge`.

These four are the first cards whose subject it is, and they take four
different positions on it:

| Card | Type | Its relationship to the token |
|---|---|---|
| Esteem | Action Modifier | **gains** it, off a successful directed action |
| Leverage | Action Modifier | **spends** it, and stops itself being paid back |
| Instability | Master | **gated** on where it sits; hands the question to the prey |
| Regaining the Upper Hand | Political Action | **moves** it by referendum |

Because it is one shared token, every one of these is a *take from
whoever held it* — `takeEdge` is a single op and `EdgeTaken` already
carried that meaning.

## §2 Esteem: which seat an action reaches

*"Only usable at the end of a successful action directed at the
Methuselah with the edge. You gain the edge."*

Almost all of this was already vocabulary: `afterResolutionByActor` (Freak
Drive's window) and `ifActionSucceeded`. The new rule is
`targetHasTheEdge`, and the thing worth writing down is that **an action
reaches a seat two ways**. A bleed names the seat in `af.target`; a rush
names one of its minions in `af.targetMinion` and the seat is that
minion's controller. The Edge belongs to a seat either way, so the rule
reads both and a card that only read `af.target` would have been offered
on bleeds and silently never on rushes.

That matters more than it looks, because **a bleed is the case where
Esteem usually cannot fire at all**: a successful bleed of 1+ takes the
Edge at p. 21, so by the after-resolution window the target no longer has
it. Esteem's real home is a directed action that is *not* a bleed for 1+
— which is exactly why the scenario test drives a rush and not a bleed.
A test that only used a bleed would have asserted three absences and
proved nothing.

## §3 Leverage: the rider is the whole card

*"Burn the Edge to get +1 bleed that does not count against the limit. You
cannot gain the Edge this action. If you would get the Edge, it is burned
instead."*

Three sentences, one bargain, so one primitive. Without the third clause
the card is nearly free: you burn the Edge, the bleed you swelled
succeeds, and p. 21 hands the Edge straight back to you. The rider exists
to stop that, and it is a **redirection, not a suppression** — the token
still moves, it just goes to the middle of the table. So the flag is
`ActionFrame.edgeBurnedInsteadOfTaken` and the branch lives in
`finishAction`, at the moment the card is talking about, rather than
anywhere near the card.

- **"Burn the Edge" is a gate on the OPTION.** You cannot burn what you do
  not hold, and in a legal-move engine that means the card is not offered
  — the same shape as wave 56's blood gate on a cancel.
- **`limited: false`** is the printed "does not count against the limit",
  which is what lets an ordinary limited bleed modifier still be played
  before or after [LSJ 20100218] [RTR 20180511-2].

## §4 Instability: a master that asks the seat it is played against

*"Only usable if your prey controls the Edge or the Edge is uncontrolled.
Your prey may take the Edge if it is uncontrolled. You gain 2 pool. Only
one Instability may be played each turn."*

Two new gates on `CardSpec`, both small and both general:

- **`requiresEdge`** — where the token has to sit for the card to be
  playable. Two shapes so far, `"preyOrUncontrolled"` (Instability) and
  `"self"` (Leverage, which needs to hold it to burn it).
- **`oncePerTurnByName`** — recorded on the TURN frame
  (`tf.oncePerTurnCards`), because the printed line makes the turn the
  scope and says nothing about the seat: one Instability per turn across
  the table, not one per Methuselah. It is appended at **resolution**, so
  a card cancelled as played does not spend the turn's one use, and the
  frame dies with the turn, which is the whole of the bookkeeping.

The interesting clause is *"your prey **may** take the Edge"*. "May" is
the prey's word, so it is a question put to **them** — the only place in
the pool where a master card raises a choice frame for the seat it is
played against. It reuses `raiseChoice` + `choiceByKey` with
`optional: true`, so declining is plain `pass` and the frame needs exactly
one answer. The `options` function re-reads `state.edge` rather than
trusting the play-time gate: nothing can move the token in between today,
but the alternative is an offer that could go stale, and the cost of
asking again is nothing.

"You gain 2 pool" is **unconditional** — it does not depend on what the
prey answers — which is why the two effects are listed in print order and
neither reads the other.

## §5 Regaining the Upper Hand: the term is the vocabulary

*"Choose a Methuselah. Successful referendum means the chosen Methuselah
gets the Edge."*

`refChooseSeatsBurn` already taught the referendum machinery to offer
"choose a Methuselah" as terms, and the `seats` term is where the answer
lands. `refGiveEdge` is the same term with a different payout, so the only
new code is one terms case (exactly one seat, every standing Methuselah a
legal answer **including the caller's own** — the card says nothing about
who) and one outcome case.

## §6 What the wave found

**No engine defect** — the third wave running, which is worth noting
rather than glossing: the vocabulary is now deep enough that a family of
four cards across four card types can land needing only gates and
payouts. The cards found the *shape* of two things instead:

**An action reaches a seat two ways** (§2), and a condition about "the
Methuselah this action is directed at" has to read both `af.target` and
`af.targetMinion`'s controller. This is the same family as the
`meetsRequirements`-forgotten-four-times bug in a new place: a question
that looks like it has one source and has two.

**And a test whose positive case was impossible.** Esteem's obvious
scenario is a bleed, and on a bleed the card can almost never fire,
because p. 21 has already moved the token by the time its window opens.
The first draft therefore asserted three absences and would have passed
with the card entirely unimplemented. Driving a **rush** instead gives it
a real positive — and exercises the `targetMinion` branch that the bleed
path never touches. **When every case in a test is a negative, the test
is telling you something about the fixture, not about the card.**

Fuzz: all four dealt in, sixty seeds green. Offered over those seeds —
Regaining the Upper Hand 44, Instability 12, Leverage 7, **Esteem 2**,
which is about right for a card that needs a successful directed non-bleed
action against the one seat holding the token.
