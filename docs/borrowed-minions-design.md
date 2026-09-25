# Borrowed minions — design (wave 91)

Three masters that take a minion off another Methuselah. One mechanism; the
family differs along two axes, and both are asserted by comparing the cards
against each other rather than one at a time.

| Card | KRCG | Cost | Text |
| --- | --- | --- | --- |
| The Art of Love | 100096 | — | Master. Take control of an ally controlled by another Methuselah until the end of your turn. |
| Malkavian Dementia | 101150 | — | Master. Take control of a ready Malkavian that another Methuselah controls until your next unlock phase. |
| From a Sinking Ship | 100793 | 1 pool | Master. Take control of a minion controlled by a Methuselah with 3 or fewer pool. Not usable to take control of a vampire with capacity 7 or more. Only one From a Sinking Ship can be played in a game. |

Printed text read from `data/vtes-raw.json`.

```
HOW LONG   end of your turn → your next unlock phase → never given back
WHO        an ally          → a ready Malkavian      → anyone a poor
                                                       Methuselah controls
```

## 1. What the wave found — before a line was written

**The mechanism already existed and I nearly built a second one.** The design
started with a `GameState.borrowedMinions` list, an `until` field on
`ControlChanged` and a fold to maintain it — and then `endTurn` turned out to
contain this, from an earlier wave:

```ts
// "…take control of them until the END OF YOUR TURN" (Puppet Master
// superior) — the one borrowed-control card in the pool.
```

`MinionState.controlRevertsTo` plus a sweep in `endTurn`, with an `ops.borrowMinion`
op in front of it. All of it was reverted and this wave extended what was there
instead. That is the CLAUDE.md lesson in its exact printed form — *"it already
exists" is a claim to CHECK, not to make* — and the thing that hid it was that
the existing code is filed under `docs/taking-actions-design.md`, a doc about
Puppet Master, not about control.

Had the second model shipped, nothing would have failed: two mechanisms would
each have returned their own loans correctly, until the first card that borrowed
through one and was read through the other.

## 2. One return address, two moments

The extension is a **second field, not a second mechanism**:

- `controlRevertsTo` — where the minion goes back to (unchanged).
- `controlRevertsAt?: "endOfTurn" | "borrowerUnlock"` — *when*. **Absent means
  `endOfTurn`**, which is what every borrow in the pool meant before this wave,
  so Puppet Master keeps working without being touched.

`returnBorrowedMinions(borrower, when)` is the one sweep, called from both
moments: `endTurn` for `endOfTurn` and the unlock phase for `borrowerUnlock`. A
loan therefore cannot be returned by one rule and forgotten by the other.

Three details that are rules, not plumbing:

- **The moment is the BORROWER's, not the owner's.** "Until your next unlock
  phase" is a whole turn longer than "until the end of your turn": the borrower
  acts with the minion this turn, keeps it through everybody else's turns, and
  hands it back on the way into their own next one.
- **The return happens BEFORE the unlock sweep.** Otherwise the borrower's own
  unlock phase would rest somebody else's vampire on the way out of the door. A
  minion borrowed locked goes home locked and unlocks in its own controller's
  next unlock phase.
- **`endOfTurn` still sweeps every seat**, as it always did: a loan made out of
  turn ends at the next turn boundary, and narrowing that to the borrower's own
  turn would have changed a rule this wave is not about. Only the new duration is
  scoped to one seat.

`ops.borrowMinion(minion, to, until = "endOfTurn")` carries the duration;
`until: "permanent"` on the card side is not a borrow at all and calls
`changeMinionControl` directly. The duration is a **named value on every card**
rather than a default, because a loan that forgets to end is a permanent theft
and nothing on the table would show which was meant.

## 3. Who may be taken

`takeControlOfMinion.who` filters on kind, clan, readiness, a capacity cap and
the *controller's* pool. Two readings worth recording:

- **"Controlled by another Methuselah" is in all three cards**, so it is the rule
  in the enumerator rather than a per-card filter: taking your own minion is
  never offered.
- **The capacity cap is about VAMPIRES.** An ally's `capacity` field holds its
  life in this engine, so applying "not … capacity 7 or more" to an ally would
  quietly make it a different card. The cap is checked only for
  `kind === "vampire"`.
- **"Ready" is the region, not the lock** (p. 11). A *locked* Malkavian is a
  legal target for Malkavian Dementia; a torpid one is not. Both directions are
  asserted, and the locked one is also the case that makes the return's lock
  state observable.

## 4. Tests

`tests/cards/borrowed-minions.test.ts` — 10 cases on one board that contains,
deliberately: a ready Malkavian, a **locked** Malkavian, a non-Malkavian vampire,
an ally, an ally of the *player's own*, a seat on 3 pool and a capacity-8 vampire.
Each card's filter has something in that board it must take and several it must
refuse.

The duration axis is pinned by walking whole turns: The Art of Love's ally is back
with its owner on Bob's turn; Malkavian Dementia's is **still Alice's** through
Bob's and Carol's turns and returns at Alice's next unlock, locked; From a Sinking
Ship's minion is still Alice's a full round later and carries no return address at
all.

**A test-writing trap worth keeping:** a master option's id is
`play:<Name>:<mode>:<target>:<cardInstanceId>`, so the target is the
**second-to-last** segment. The first draft matched the end of the string and
reported all three cards as offering nothing — the failure looks exactly like an
unimplemented card, and the option lists in the error output are what showed the
engine was right.

Mutation-checked: ignoring the duration (every loan returned at every moment) and
removing the unlock-phase return, each failing exactly the one case that separates
the two durations.

Fuzz: all three added. Control moving between seats is what the conservation
replay is least prepared for — blood and counters travel with the minion (p. 16) —
and one loan spans a whole round, so the borrowed minion acts, fights and can be
burned while it is somebody else's.

## 5. Counts

Library 831 / crypt 217 / total 1048; supported 930 / 1048.
