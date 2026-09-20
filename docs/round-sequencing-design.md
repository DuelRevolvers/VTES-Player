# The shape of the round

Wave 81 (2026-09-20). Vanish from the Mind's Eye (102090),
Sanguinary Wind (101678), Rapid Thought (101544),
Relentless Pursuit (101594).

Four cards that change how the **round runs** rather than what a strike does:
when a press may be used, who chooses a strike first, whether strikes can be
dodged at all this round, and what a continued round pays out. Each is
observable only through the sequence, so every assertion is about **who is
asked, when, and what survives the round boundary**.

---

## §1 — What each card is

| Card | Basic | Superior |
| --- | --- | --- |
| Vanish from the Mind's Eye | press, **end-only** | press |
| Sanguinary Wind | strikes undodgeable this round — **before strikes** | …**after** strikes chosen |
| Rapid Thought | maneuver **or** press | opponent chooses their strike first |
| Relentless Pursuit (1 blood) | press | press, **+2 hand size if a round follows** |

Vanish is the control and a **mirror**: the restricted press is the *basic* and
the free one the superior, so a gate applied to the whole card rather than to
one mode would show up here. Nothing new was needed for it — wave 71 built
`press.endOnly`.

## §2 — Who chooses a strike first

`nextStriker` hard-coded "acting, then opposing", which is the default (p. 30).
Rapid Thought's superior flips it for the round, so the order is now derived
from a round-scoped flag and the loop walks whichever order is in force.

The gate is the interesting half. "Only usable during the choose-strike step,
and **only if this vampire would choose his or her strike first**" means the
card is offered only to the side whose turn it actually is, and — because the
swap makes the *other* side first — it can never be played twice. All three
conditions are asserted, including the negative: after the swap, Alice is asked
for her strike and the card is **not** on her list.

## §3 — A dodge that has no effect

> "This vampire's strikes may not be dodged this round."

The ruling says exactly how to build it: "Does not prevent the opponent from
dodging, **the dodge just has no effect**" [LSJ 20030902-2]. So this is not a
gate on the dodge option — it is a third source folded into the one read in
`resolveStrikes`, beside `Strike.undodgeable` (the declaration) and
`PermanentStatics.strikesUndodgeable` (a static on the striker). That read
already carried a comment explaining why the three belong together: a flag every
Strike-building site has to remember is one a new site forgets.

The card's two modes differ **only in their window** — before strikes are
chosen, or after — so the effect carries `window` as data rather than the
compiler inferring it. A timing difference that is the card's whole second mode
cannot be derived from what the effect does.

Tested with a **real granted dodge** and a check that Bob actually dodged, plus
a control showing the dodge works without the card. Wave 76 established why:
a dodge is never a free option, so a walker asked to dodge silently hand-strikes
instead and every "undodgeable" assertion passes on a board where nothing was
dodged.

## §4 — A grant that depends on what happens next

> "…and **if another round of combat starts**, you get +2 hand size for the
> remainder of combat."

This cannot be answered when the card resolves: the press it rides on is the
thing that might start the round. So the grant is **owed** at play time and paid
at the round boundary, where "another round is starting" is a fact rather than a
prediction — `cf.handSizeOnNextRound`, drained and cleared beside the other
round resets.

Three assertions, because the interesting states are three: owed-but-unpaid in
round 1, paid in round 2, and — the pair that matters — the **basic** owes
nothing. Both modes press, so "round 2 happened" proves nothing on its own.

## §5 — Mutation-checked

All eleven assertions passed on the first run. Per wave 79's rule, all three new
mechanics were broken on purpose in one pass — the undodgeable read forced to
`false`, the strike order forced to the default, and the hand-size debt dropped
— and **five tests failed across all three**, clean again on restore.

One note from doing it: the restore of the undodgeable read did not match by
string replacement and had to be fixed with the editing tools. Shell
string-surgery is fine for *making* a temporary mutation and unreliable for
undoing it, which is the same reason CLAUDE.md forbids it for real edits. Check
the restore, do not assume it.
