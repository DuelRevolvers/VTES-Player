# Richer options — what the engine already knew and threw away

2026-09-03. A follow-on from phase 5.

**The principle: the engine is the only thing that actually knows what an
option does. When it does not say, every consumer re-derives it — the UI
by leaving the number off the screen, an agent by building a second,
drifting model of the card pool.**

Both new fields are things the enumerator **already computed in order to
decide the option was legal**, and then discarded.

---

## 1. `declareBlock` now carries its own arithmetic

Before: `{ id, kind, label, minion }`. The enumerator had just called
`blockTollFor` (to know the minion could pay at all) and
`blockWouldSucceed` sits in the same module — neither number survived.

Now it also carries **`intercept`**, **`stealth`**, **`wouldSucceed`** and
**`toll`**, and the label reads *"W: attempt to block (2 vs 1) (burn 1)"*
or *"…(0 vs 1, would fail)"*.

Three consumers, one source:

- **The UI** dims a block that would fail. It is **marked, never hidden**
  — p. 25 makes the attempt legal and either side may still play a card,
  so it stays the player's call; they simply should not have to find two
  numbers elsewhere on the screen to make it.
- **The AI** reads `wouldSucceed` instead of cross-referencing
  `PlayerView`, and now subtracts the toll from the value of blocking.
- **The tests** in `block-tax.test.ts` assert `toll` rather than parsing
  the label, which is what they were always about — and the label is now
  free to change without breaking them.

`wouldSucceed` is deliberately **"right now", not a promise.** Cards are
still to come.

---

## 2. `playCard` now carries what it costs

Before, the button could not show a price and an agent could not weigh
one play against another, even though `playCostFor` had just run to
decide affordability.

Now every `playCard` option carries `cost: { blood, pool }` — the **LIVE**
cost, with every modifier in force already in the number
(docs/play-cost-design.md), not the printed one.

**Done in ONE place, not at the forty `makeOption` call sites.**
`compileSpec` wraps the handler's `options` and fills the field in.
Forty sites are forty chances to forget, and — the important part — **a
cost that appears on some cards and not others is worse than none**: the
UI would price half its buttons and an agent would read the unpriced half
as free.

### 2.1 The hand-rolled gap, for the third time

Wrapping `compileSpec` covers spec-compiled cards. A **hand-rolled**
handler builds its own options and reported nothing — and this is exactly
the failure `docs/last-equipment-modifiers-design.md` records twice
already: `costTypes` was undefined on Blood Doll and .44 Magnum, so a
play-cost modifier keyed on "master cards" silently skipped them.

So the fallback lives in **`backfillCentralQueries`**, beside the others:
any `playCard` option still lacking a cost gets the handler's own
declared price. Precise where the compiler can be precise, honest
everywhere else, and **never absent**.

`tests/cards/central-queries.test.ts` walks a real game and asserts no
`playCard` option is ever missing a cost.

---

## 3. A test that was asserting the wrong thing

The AI test "refuses a master card that would spend it down to nothing"
was written with **Blood Doll**, and it failed the moment the AI started
reading real costs.

**Blood Doll costs nothing.** The registry says `poolCost: null` and the
card text confirms it — it is a free master. The AI played it and was
*right* to; the test had assumed a price that was never there, and the
guard it was checking would only have looked correct because the old
policy refused every master at low pool regardless of cost.

Rewritten with **Channel 10** (2 pool), which is what the assertion was
always trying to say. Recorded because it is the same shape as every
"empty for the wrong reason" bug in this project, one level up: a test
can pass for the wrong reason too.

---

## 4. What this does not do

The AI still **does not read card text**, and should not: that would be
the second, drifting model this whole change exists to avoid. What
improved is that the option now answers *"what does this cost me"*, which
is a question the engine can answer authoritatively and the AI cannot.

The obvious next candidates, all the same shape — a number the enumerator
computes and drops:

- **`takeAction` for a bleed** could carry the bleed amount (`currentBleed`
  is right there), so the button reads "bleed Bob for 2" and the AI stops
  reading `bleedAmount` off the minion and missing every modifier.
- **`castVote`** already carries `count`, which is why the vote scoring is
  the least guessy part of the policy — a worked example of the payoff.
- **`chooseStrike`** could carry the damage it would inflict.
