# Taxing and barring a block, from a card in play

Wave 65 (2026-09-18). Aching Beauty (100018), Artistically Inept (100101),
Kaymakli Barrier (101034), Burden the Mind (100268).

Four cards that sit on a minion and change what blocking costs, or whether
it is possible at all. The pool already had the action-scoped versions of
all of this (`ActionFrame.blockCosts`, `blockRestrictions`) and the
persistent versions of some of it; this wave is the persistent side, and
**half of it was already built**.

| Card | Sits on | What it does |
| --- | --- | --- |
| Aching Beauty | a Toreador | the blocker's controller burns 1 pool |
| Artistically Inept | a Brujah | Toreador cannot attempt to block them |
| Kaymakli Barrier | a younger vampire | no blocking undirected actions; +1 blood per directed action |
| Burden the Mind | any minion | unlocking them off-turn costs +1 pool |

---

## §1 — Two cards that were already in the engine

- **Aching Beauty** is `statics.blockedPoolToll` — written for Terrifying
  Visage, which prints the same sentence. The whole card is one existing
  field on a master that attaches to a Toreador.
- **Artistically Inept** is `statics.cannotBeBlockedBy.clans` — written for
  Cloak of the Abalone, read off the ACTING minion's attached cards.

Both were found by looking before designing. **A non-deferral is a claim
about the code as it is**, and the cheap half of a wave is usually a field
that already exists under another card's name. The tests still pin them: a
spec that names the wrong field compiles and does nothing.

The negative space is what those two tests are really for — Aching Beauty
charges nothing when the bleed goes **unblocked** (it is a penalty for
being blocked, not a toll for the attempt, which is `blockCosts`), and
Artistically Inept leaves every non-Toreador blocker alone.

## §2 — Who a card sits on is not who it answers to

Three of the four go on a minion its controller may not control: "put this
card on **a** Toreador", "on **any** ready Brujah", "on **any** minion".
The card still answers to the Methuselah who played it (p. 16), which
`attach.scope: "any"` and the recorded controller already handle. Aching
Beauty on your own Toreador is the normal line; Artistically Inept on an
opponent's Brujah is a real play, because what it does — shutting out
Toreador blockers — is a gift the card's owner may want somebody else to
have.

## §3 — Two directions of one question

Kaymakli Barrier bars a block **and** taxes an action, on the same bearer,
keyed on the same word:

> "This vampire cannot block **undirected** actions. **Directed** actions
> cost this vampire an additional blood."

So the card is a pair of tests on `af.directed`, in two different places:
the block-eligibility generator and the action announcement. Each is a new
static (`cannotBlockUndirected`, `directedActionBloodTax`), and each went
in **beside its existing sibling** rather than in a new place:

- the bar is the third member of a family — unconditional (`cannotBlock`),
  by the actor's kind (`cannotBlockKind`), and now by what the action is
  aimed at,
- the tax sits next to the torpor tax, and copies its guards: pay what you
  have, never below zero, charged at announcement like a printed cost.

**A new call beside an existing one copies its guards before its shape.**

## §4 — The target filter an "any minion" attach did not have

`attachSelf.target: "anyMinion"` offered every minion at the table.
Kaymakli Barrier says "a **younger ready vampire**", so the effect gained
`targetFilter { kind, youngerThanActor }` — read at ENUMERATION, where the
acting vampire is known, because "younger" has no meaning without them.

The test asserts the **whole option list** rather than probing for `:M:`:
an id is `play:<Name>:<mode>:<actor>:<target>:<cardId>`, so the actor's own
id sits in the same string and a substring probe answers about the wrong
segment. That is what the first draft of this test did, and it "failed"
against correct code.

## §5 — Burden the Mind: one door, not two

> "While it is not this minion's turn, using an effect to unlock this
> minion **or to allow this minion to block as if unlocked** costs an
> additional pool. This minion may burn this card and unlock as a Ⓓ
> action."

Two ops can unlock a minion so it may react — `unlockAndAttemptBlock` (the
wake-and-block cards) and `unlockReactingMinion` (Guard Dogs and friends) —
and the "block as if unlocked" phrasing names a third thing the pool does
not yet have. So the charge is **one private helper** both ops call, and a
third door would have to call it rather than quietly skip the clause. The
`onAnyUnlock` lesson, applied before it bit rather than after.

Two readings recorded rather than guessed:

- **Who pays.** "Costs an additional pool" is a cost on the effect, and
  every effect that reaches these ops is a card a Methuselah plays for
  their **own** minion, so the payer is the bearer's controller.
- **"While it is not this minion's turn"** is the turn frame's seat, and on
  their own turn the card says nothing at all.

The escape clause is `vulnerableTo` with `who: { bearerOnly: true }` and a
new `unlockBearerOnBurn` — the mirror of `bearerPenalty`. Announcing the
action locked the bearer (p. 25), so unlocking them is the whole point of
taking it, and the rider is read before the burn, because the bearer is
only findable through the entry.

## §6 — What the tests needed that the fixtures do not give

Three gates, all named in CLAUDE.md, all of which bit once here:

- Guard Dogs is `[ani]`, usable by a **locked** minion, only during a bleed
  **of you** — three conditions the fixture has to build, not assume.
- A card that unlocks at RESOLUTION needs its as-played window to close
  first (p. 7), so the trace passes three times before asserting.
- The impulse order on somebody else's turn is the engine's business: the
  two traces that guessed it were replaced by a walker that asks the engine
  whose impulse it is and prefers `pass`.
