# The cancel half of the basic combat cards

Tranche 1 wave 56, 2026-09-16 (v0.10.47). Backstep (100125), Disengage
(100554), Groundfighting (100861). Library 690 → 693.

Wave 20 built the basic dodge/maneuver/press cards and wrote down what it
did not build (`docs/basic-combat-design.md` §4):

> *"The rest of the 'do not replace until after combat' cards each add a
> second clause and are separate builds… **Disengage** (press to end, or
> burn 1 blood to cancel a grapple), **Groundfighting** (maneuver or press
> or cancel, and requires an anarch)… They all use `delayedReplace:
> "afterCombat"` as-is when they land."*

That deferral held up: the shared clause had been built and the second
clauses were the work. This wave is those second clauses.

## §1 The shape: one card, two windows, one choice

Each of these cards can be played in more than one window, and the player
picks which. That is a **mode**, not two effects — the compiler already
keys options per mode and `combatWindowFor` already derives the window
from a mode's effects, so Disengage's press half and cancel half simply
compile to different windows and the enumerator offers whichever is live.
Groundfighting has three. No new machinery, and the alternative — one mode
with a runtime branch — would have had to re-derive the window by hand.

## §2 Disengage: the narrowing, and who pays for the cancelled card

*"Burn 1 blood to cancel a grapple card (such as Immortal Grapple or
Mighty Grapple) as it is played (no cost is paid for that card)."*

`cancelCombatCard` already existed for Death Seeker — *"cancel a combat
card played by the opposing minion, and its cost is not paid"* — and
reaches **any** combat card. Disengage is the same primitive with a
keyword filter, matched against `CardPlayFrame.keywords`, which has been
denormalized at push since wave 39 precisely so no card reads another
card's spec.

Two readings worth recording:

- **Burning 1 blood is a gate, not just a payment.** *"The card cannot be
  played if the minion cannot afford to burn the blood"* [ANK 20210226] —
  which in a legal-move engine means the gate belongs on the **option**,
  not on the resolution. The same ruling adds that the burn is **not**
  reduced by cost reducers, because it is an effect rather than the card's
  cost, so it is emitted in the resolve rather than folded into `costOf`.

- **The refund is the CARD's clause, not the cancel's.** Death Seeker and
  Disengage both print *"no cost is paid for that card"*; Groundfighting
  does not, and the general rule is that a cancelled non-action card's
  cost **is** still paid [RBK cancel-a-card] [ANK 20260216]. The existing
  callers all refunded, so `costIsStillPaid` names the exception rather
  than flipping the default — and the two cards in this wave now disagree
  on purpose, which is the point worth asserting.

The press half is `press.endOnly`, already built for Open Grate, and p. 32
makes it narrower than it looks: the only way a press *ends* combat is by
cancelling one that is already standing, so with none standing the card is
offered in no window at all.

## §3 Groundfighting: a restriction the rulings scope tightly

*"Burn 1 blood to cancel a combat card played by the opposing minion that
would **restrict this anarch's choice of strikes** this round as it is
played."*

"Restricts the choice of strikes" is not a property anything in the engine
could answer, and it is emphatically **not** "is a restriction". The
rulings [LSJ 20050221] [LSJ 20050224-2] draw the line by hand:

| Reaches | Does not reach |
|---|---|
| "cannot use equipment" (if the target has a weapon) | maneuvering, setting the range |
| "hand strikes only" (Immortal Grapple) | "cannot be dodged" |
| superior Thoughts Betrayed, Shape Mastery cancelling a strike | preventing additional strikes, or the ability to strike at all |
| | destroying or stealing equipment |
| | restricting the use of Disciplines |

So it is answered **centrally in `compileSpec`** and stamped onto the play
frame as `restrictsStrikeChoice` — the third member of the `isStrike` /
`keywords` family, and for the same stated reason.

It is a **named** value (`"strikes" | "equipment"`) rather than a boolean,
because the two bars are cancellable under different conditions: *"can
cancel cards preventing the use of equipment **if the target has a
weapon**"*. A minion holding no weapon has had nothing restricted, so the
equipment bar is a question about the **cancelling minion** as well as
about the card being played. A boolean would have compiled, typechecked
and offered the cancel to an unarmed anarch — the "near-miss field" shape
from wave 40, one level up.

`restrictOpponent` carries maneuver, press and equipment in one primitive,
so the test is on the **field**, not on the kind.

## §4 Backstep: a credit handed across the table

*"Maneuver, only usable to go to long range. If the opposing minion's
strike successfully inflicts any damage on this minion this round, the
opposing minion gets an optional press."*

`maneuver.onlyToLong` already existed (High Ground). The rider did not,
and it is the only thing in the pool that hands a combat credit to the
**opponent** — it is the price of the maneuver, which is why both halves
live in one mode rather than being two things a player chooses between.

`cf.pressIfDamaged` records the minion to be **hit**, not the one to be
paid: the payer is whoever struck them, which `inflict()` already knows as
`from`. It pays out at infliction, in the same place and for the same
reason as Weighted Walking Stick's counter spend — *"successfully
inflicts"* is that moment, and prevention afterwards does not take it
back. The rider is then **spent**, so a second strike in the same round
pays nothing more: the card says "an optional press", singular.

*"The optional press can only be used during the current round"*
[TOM 19960521] needed nothing — `cf.presses` is already a per-round credit
pool, reset each round. The rider carries its own `round` anyway, because
the rider is not what resets.

## §5 What the wave found

**Nothing broken.** The second wave in a row with no engine defect, and
the first time in this run that a *deferral* turned out to be accurate:
wave 20 named the blocker (a second clause per card), named the shared
piece that was already built (`delayedReplace: "afterCombat"`), and both
claims held sixteen waves later. Worth recording as the counter-example to
"a deferral is a claim about the code as it was" — the claim is not
usually wrong, it is usually *unchecked*, and what made this one survive
is that it named a specific mechanism rather than a feeling.

**One near-miss, caught by the rulings rather than by the code.** §3 — a
boolean `restrictsStrikeChoice` reads correctly, compiles, typechecks and
is wrong for an unarmed anarch. Only [LSJ 20050221]'s parenthesis says so.
**Read the rulings before choosing the type**, not after.

**And a fixture that would have answered the wrong question.** The test's
first draft had the blocker play Immortal Grapple, which requires Potence,
and the fixture's blocker has Dominate only — so the card was never
offered and every assertion about the canceller would have passed or
failed for an unrelated reason. The helper **asserts** the card was played
rather than returning a sentinel; the wave 52 lesson, met in the helper
this time rather than in the test body.

Fuzz: all three dealt in beside Immortal Grapple (the pool's only grapple
card, and the only thing Disengage's cancel half can name). Sixty seeds
green; Backstep offered 13 times, Groundfighting 9, Disengage 2.
