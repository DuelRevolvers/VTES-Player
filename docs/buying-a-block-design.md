# Buying a block

Tranche 3, wave 36. Library **624 → 627**. Three reactions that each pay a
different price to get a block in — the first non-event wave since 30.

| Card | KRCG | Printed |
|---|---:|---|
| Legwork | 101093 | Do not replace until your next unlock phase. **+1 intercept. Not usable by a vampire with more than 0 intercept.** |
| Pack Tactics | 101343 | Do not replace until after this action. Only usable during a bleed against you. +2 intercept. **A vampire cannot play both Pack Tactics and Elder Intervention during the same action.** |
| Eluding the Arms of Morpheus | 100628 | Only usable by a **locked** vampire. This vampire **unlocks and attempts to block**. |

The third needed **no engine work at all**: `unlockAndAttemptBlock` has
existed since Sense the Savage Way, and `byLockedMinion` gates it. The
card is four lines of data. That is what the primitive vocabulary is for,
and it is worth saying out loud after five waves that each needed new
kernel code.

## §1 — A gate on a DERIVED value of the reacting minion

*"Not usable by a vampire with more than 0 intercept"* cannot be a
`UsabilityRule`. Those are asked once per card play, with the seat and
the action frame in hand; this one has to be asked **once per candidate
minion**, because the answer differs between two vampires in the same
play area. So `onlyIfNoIntercept` is a spec field checked in the
per-minion loop, beside the existing per-minion gates.

It reads `currentIntercept`, not a printed number — so a vampire whose
intercept comes from a location, a retainer or an earlier card this action
is excluded, which is what the card means and what a printed-stat read
would have got wrong.

## §2 — Two cards that bar each other

*"A vampire cannot play both Pack Tactics and Elder Intervention during
the same action."* Three things about the scope, and each of them is a way
to get it wrong:

- **Per VAMPIRE**, not per Methuselah. `af.played` records
  `{minion, card}`, so the filter is on both — another of your vampires
  may still play the other card.
- **Per ACTION**, not per turn — so it reads the action frame rather than
  the seat's or the minion's own history.
- **Both ways.** The clause is printed on Pack Tactics; Elder Intervention
  has been in the pool since the V5 build with the comment *"Pack Tactics
  clause is moot: that card is not in the V5 pool."* It is not moot any
  more. `notWithThisAction` is named on **both** cards, because a bar
  written on one card only works in one direction.

## What the wave found

**A deferral note expired the moment its other half arrived.** Elder
Intervention carried an explicit, correct-when-written comment saying its
mutual-exclusion clause could not matter. Admitting Pack Tactics made that
card **partial** — silently, in the same commit, with nothing failing.
`no-partial-cards.test.ts` cannot see this: it asserts the card's own text
is implemented, and Elder Intervention's own text *was*, right up until
the card it names entered the pool.

This is the "a deferral is a claim about the code AS IT WAS" lesson with
the arrow reversed. The usual failure is re-deriving a blocker that has
since been built. This one is a note that was true when written and was
falsified by a **later wave**, in a file nobody had reason to open. The
general shape: **a card whose text names another card by name is a
two-ended dependency**, and admitting either end has to check the other.
There are no other cards in the pool that name a card this way — that is
now checked, not assumed.

## Notes on the tests

Two of the three gates in CLAUDE.md bit in one sitting, which is worth
recording because both cost a cycle:

- **Intercept is only offered when NEEDED** (p. 26), so a 0-vs-0 bleed
  offers none of these cards. The fixture gives the acting vampire 1
  stealth.
- An intercept reaction is offered **inside the block attempt**, not in
  state A — the compiler asks `ba.blocker === this minion`. So the fixture
  declares the block first. Eluding is the opposite: it needs state A with
  no attempt open, since attempting is what it does.

And one new one: **a successful block locks the blocker again** (p. 27),
so `locked === false` is not evidence that Eluding worked. The assertion
is the `BlockSucceeded` event instead.

## Tests

`tests/cards/buying-a-block.test.ts`, 3 tests. Legwork's is the negative
one: the same fixture offers it, and stops offering it once the vampire
has 1 intercept from a card in play.
