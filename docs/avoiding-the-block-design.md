# Avoiding the block

Wave 83 (2026-09-20). Uncontrolled Impulse (102059),
Walk through Arcadia (102140), Horrific Countenance (100936).

Three **action modifiers** that buy the same thing — not being blocked — at
three different prices. The first bucket change in nine waves, and most of what
the wave cost was relearning the action frame's windows rather than building
anything.

---

## §1 — What each card is

| Card | Price | What it does |
| --- | --- | --- |
| Uncontrolled Impulse (1 blood) | must be the turn's **first** action | +2 stealth |
| Walk through Arcadia (1 blood) | a **coin flip** | heads: unblockable; tails: 1 damage |
| Horrific Countenance (4 blood) | 4 blood, **after** the block | unlock the blocker, cancel the block, unblockable |

`restrictBlocking("all")` already meant "this action is unblockable" — the
union of the two kind bars, with a comment citing Mantle of the Moon — so two of
the three needed no new way to say it.

**Several nearby cards are INERT** and stayed out: Strange Day, Dusk Work,
Excellent Thirst and Neebi all require a Laibon or Aye, and the V5 pool has
neither.

## §2 — A price paid on the TURN

> "Not usable if any **non-mandatory** actions have been performed this turn."

A turn-frame counter, incremented at **announcement** — which is the only moment
that can tell a mandatory hunt from a chosen one, because a vampire with no
blood *must* hunt (p. 21) and its blood is still 0 at announcement and not
afterwards. Read the count later and the two are indistinguishable.

The gate is "more than one", not "more than zero": the action the card is being
played into has already been announced and therefore already counted. That
off-by-one is the kind of thing that makes a card either always or never
playable, so both directions are asserted — playable on the first action, not
playable after another, and playable after a **mandatory** hunt.

## §3 — The pool's first coin flip

> "Flip a coin. If it is heads, this action is unblockable. If it is tails, this
> vampire takes 1 unpreventable environmental damage."

Through `ops.randomIndex(2)`, the engine's seeded RNG, because architecture
principle 2 says all randomness goes through it — a card that reached for
`Math.random` would make replays, saved games and the fuzz's log-replay
conservation check all wrong, and none of those would fail loudly.

Testing a coin needs more than one flip:

- **Both outcomes must occur** across seeds. A coin that always landed the same
  way would pass any single-seed test.
- **Each outcome must be coherent** — heads bars every blocker and costs no
  extra blood, tails costs exactly a point and bars nobody.
- **The same seed must flip the same way twice.** That is the property the RNG
  exists for, and it is one line.
- **Heads has to stop Bob blocking**, checked on the option list rather than on
  the state flag.

## §4 — Undoing a block that already happened

Horrific Countenance is played in the first window of the combat the block
produced, which is where this engine puts every "when this action is blocked"
card. Three effects, in an order that matters:

- **Unlock the blocker** and read who that is **before** the cancel — after it
  there is no combat frame left to ask. The same reason
  `barBlockerClanThisTurn` sits where it does, two lines up.
- **Cancel the block and combat**, handing the action back.
- **Then** make the action unblockable — after the cancel, because the action
  frame is what carries the restriction.

That last clause is not decoration: without it another of Bob's minions would
simply block the action the card just freed, and 4 blood would have bought one
round of delay. Asserted directly — Bob is offered no block afterwards.

## §5 — What the wave cost: the windows, not the cards

Six of nine assertions failed on the first run, all fixtures, all the same kind
of mistake — assuming where a modifier is offered:

- **A modifier lives in `action.effects`**, not `action.announce`. The announce
  window carries blocks and reactions; a fixture that stopped there sees only
  `pass`.
- **A STEALTH modifier is only offered while a block attempt is underway**
  (p. 26, "only when needed"). Uncontrolled Impulse is a stealth card, so its
  fixture has to get Bob to declare a block first — one window further again
  than the other two cards in its own wave.
- **`threeSeatGame` gives Alice one minion**, and two tests needed a second
  action in the turn.
- **A fixed trace between announcement and resolution is a guess.** Two tests
  failed with "Alice has no option bleed:V1 in action.effects" because the pass
  count was short; the helper is now a walker that runs until the action frame is
  gone. A trace one step short leaves the engine mid-action with nothing to show
  that anything went wrong.

None of these were engine defects, which is worth saying plainly: after nine
waves in Combat the cost of the bucket change was entirely in the fixtures. The
three mechanics were then mutation-checked per wave 79 — the turn gate widened,
the coin forced to heads, the unblockable dropped — and **four tests failed**,
clean on restore with all three sites verified by grep.
