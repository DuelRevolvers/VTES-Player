# After-combat payoffs

Wave 82 (2026-09-20). Flesh Bond (100748), Mercy for the Weak (101204),
Torrent (101995).

Three "combat ends" cards, two of which carry a payoff that lands **after** the
combat. The wave's real content is a ruling that turned out **not to be
modellable yet, for a reason worth writing down** — and the two tests that pin
that reason.

---

## §1 — What each card is

| Card | Basic | Superior |
| --- | --- | --- |
| Flesh Bond (1 blood) | 2R damage | strike: combat ends |
| Mercy for the Weak (2 blood) | combat ends; **opposing gains 1 blood**; only if this vampire has more blood | — |
| Torrent (2 blood) | additional strike (limited) | combat ends; **the action continues as if unblocked** |

Flesh Bond is the control: an ending with **no** payoff, so the two cards below
have something to be compared against. It needed nothing new.

## §2 — The payoff itself

`gainBlood` is a new `AfterCombatRider` variant: "opposing vampire gains 1 blood
**(even at long range)**", paid where the other riders are paid, once the frame
has popped. Two details come straight from the card and the ruling:

- **No range condition**, unlike the `damage` rider beside it — the card says so
  explicitly.
- **After the end of combat** [RTR 19970630], not during it, which is why it is
  a rider at all rather than part of the strike.
- A **total read** of the recipient, because a minion can be burned during the
  combat that the payoff names.

Torrent's payoff is the existing `continueAction` rider, which Form of Mist
already used. Torrent's version is free (no blood, no stealth), and its "was
blocked while performing an action" condition is the rider's own — which is also
what stops it continuing an action after a **rush** [RTR 19970630].

## §3 — The ruling that is NOT modelled, and why

Both cards carry the same companion ruling, with the same ID:

> "The blood is not gained if an effect **continues the combat** or begins a new
> combat." [RTR 20020501] (Mercy for the Weak)
>
> "If the combat continues or a new combat begins, the after combat effect does
> not happen / is not usable." [RTR 20020501] (Torrent)

It was built first — a `cancelIfContinued` flag on the rider, discarded at the
round boundary rather than deferred, because the ruling says the effect does not
happen at all. Then the test for it failed, and the failure was the interesting
part: **nothing in the pool can continue a combat that a combat-ends strike
ended.**

- A **press** cannot. A combat-ends strike ends the combat at strike resolution;
  the press step never arrives. Asserted directly — Bob holds a press credit and
  the combat still ends.
- The pool's one **continue-the-combat** card (Hunting the Quarry superior,
  `startNewRound`) is gated `onlyIfCombatWouldEnd`, which by its own definition
  excludes a combat that ended **prematurely** (p. 30). A combat-ends strike is
  exactly that.

So the machinery was **removed rather than shipped untested**. The cards are
whole without it: the cancellation is not printed on either card, it is an
interaction with cards that are not in the pool (the ruling names Psyche! and
Telepathic Tracking).

**What would make it reachable:** admitting a card that continues or restarts a
combat after it has ended — Psyche! is the obvious one. The day such a card
joins the pool, this section is the note that says what to build. That is the
deviation-as-a-claim-about-the-pool shape from wave 72, recorded deliberately
this time instead of being discovered.

Two tests now pin the *precondition* rather than the behaviour, which is the
honest thing to assert: a press does not continue such a combat, and the payoff
therefore lands.

## §4 — The blood comparison

> "Only usable if this vampire has **more blood** than the opposing vampire."

The only card in the pool that compares the two combatants' blood. Two readings:

- **Strictly more.** Equal blood is not enough, asserted as its own case
  alongside "fewer".
- **Only against a vampire.** An ally has *life*, not blood, so the comparison
  has no meaning against one and the card is not offered. This is the
  `findMinion`/`kind` check rather than a bare number comparison, and it matters
  because an ally's life sits in the same field.

## §5 — Mutation-checked

Five of seven assertions were green first time and two failed — and the two
failures are what produced §3, so this wave got its check for free on the part
that mattered. The rest was mutation-checked per wave 79: the blood gain dropped
and the comparison gate removed, **three tests failed**, clean on restore with
both sites verified by grep rather than assumed.
