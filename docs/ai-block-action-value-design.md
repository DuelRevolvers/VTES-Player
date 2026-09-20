# Blocking — every action card is worth the same (2026-09-18)

**Status: designed, not built. Owner review before kernel code.**

Depends on nothing; shares `ai-seat-relationships-design.md` if §3(c) is
taken. `declareBlock` is **8.6% of real choices**
(`ai-decision-profile-2026-09-18.md`) — the largest share on the AI list
after the minion-phase kinds.

## 1. The defect

`scoreBlock` in `src/ai/heuristic.ts` prices what an action is worth
stopping by its **kind**:

```ts
switch (act.kind) {
  case "diablerize":  return w.blockDiablerize;
  case "hunt":        return w.blockHunt;
  case "rescue":
  case "leaveTorpor": return w.blockRescue;
  case "cardEffect":  return w.blockCardEffect;
  case "bleed":       return w.blockOther;
}
```

`ActionKind` has six members and one of them is `"cardEffect"` — which is
**every action card in the game**. Govern the Unaligned at superior, an
Embrace, a Computer Hacking, and a political action about to call a
referendum that burns six of my pool all return the same constant.

Political actions land in this bucket. **Blocking the action is the
cheapest answer to politics in VTES** — no votes needed, no cards spent
beyond the block — and the policy cannot tell one from a hunt-equivalent.

## 2. The information exists and is thrown away

`ActionFrame` carries:

```ts
actionKind: ActionKind;
/** Non-null when the action was announced with an action card. */
card: ActionCardRef | null;
```

`viewFor` copies `actionKind` into `view.action` and **drops `card`**.

The card is announced face up and its text is public (p. 25) — every
other seat at the table is reading it right now. This is the same
omission, in the same function, as the referendum frame
(`ai-referendum-view-design.md`): the projection kept the shape of the
thing and dropped its identity.

## 3. The design

Three layers, and they are worth separating because they have very
different risk.

**(a) Project the card.** `view.action.cardName: string | null`, copied
from `af.card`. Pure information, no leak, no behaviour change on its
own. Same argument as `bleed` and `stealth` beside it.

**(b) Price a political action as a political action.** The cheapest
correct use of (a) that does not build a card-name table: **the engine
knows the announced card's TYPE**. A `cardEffect` action announced with a
Political Action card is a referendum about to happen, and a referendum
is a table-wide pool event. That deserves its own weight —
`blockPolitical` — sitting well above `blockCardEffect`.

This needs no per-card knowledge, only the card's type, which the
registry has. It is one new weight and one new branch.

**(c) Price by who benefits.** The richer version: a `cardEffect` action
by my **predator** that will grow their board is worth more to stop than
the same action by a cross-table seat who is not coming for me. This
consumes `ai-seat-relationships-design.md` and is genuinely speculative —
by the §8 law, the acting seat is **the same for every blocker in the
decision**, so it can only change whether I block at all, not which
minion blocks. That is a narrower lever than it looks. **Recommended
behind (a) and (b), and measured separately, with a zero expected.**

## 4. What must NOT be built

**A table of card names to block-values.** It is a second model of the
pool, it goes stale on every card wave in silence, and the cards it would
be wrong about are exactly the new ones. The type-level rule in (b) is
the most per-card knowledge this should ever acquire.

## 5. The trap: an unblockable bucket

`blockBleed` currently dominates because `bleedAtMe` is computed first and
short-circuits the switch. Raising `blockPolitical` near it changes the
relative order of things that were never compared before — and the
existing cliff (`bleedAtMe >= myPool` adds +50) means a lethal bleed still
wins, which is correct.

But note what the §8 measurement found about this exact function: **two
quite different blocking policies produced statistically identical games**
(−0.050, −0.065, +0.031, +0.011 across four decks). That is a warning
written specifically about `scoreBlock`. A change here has a measured
prior of doing nothing, and this doc does not pretend otherwise. The
argument for building it is correctness — the bot should not be indifferent
between a hunt and a referendum — with strength as an unlikely bonus.

## 5.1 BUILT, 2026-09-18 (platform 0.10.73), and the finding is a WALL

(a) and (b) shipped; (c) shipped at zero on the `influenceUnlocks`
precedent. `ActionFrame.political` is set where the action is announced —
the only one of the three frame sites that has a card — and
`view.action` now carries `cardName` and `political`.

### THE FINDING: the branch is unreachable on these decks

Measured over 20 games per table, the seat facing a political action:

| table | political block decisions | with a VIABLE block | blocked |
| --- | --- | --- | --- |
| default | 26 | **0** | 0 |
| politics | 19 | **0** | 0 |

**Not one political action in 45 could be blocked at all.** An undirected
action carries +1 stealth (p. 22) and nothing in these decks answers it,
so `wouldSucceed` is false and `scoreBlock` returns −Infinity before any
weight is consulted. `blockPolitical` is correct, tested and **currently
unreachable in a real game**.

Worse for the doc's premise: **`blockCardEffect` was never reached
either.** Every `cardEffect` block decision in 40 games was a political
one, so the branch this item set out to split had, on these decks, only
ever taken one of its two paths.

This is the three-gates lesson arriving as a measurement rather than as
an hour of confusion: *stealth and intercept decide whether an option
exists long before any weight decides what it is worth.* The follow-up is
a deck with intercept in it, not a change to the policy.

### FOLLOW-UP DONE, 2026-09-19 — and it found something else

Intercept went into the politics table: Oluwafunmilayo ×3 (+1 intercept
**against political actions**) plus Revenant ×8 and Raven Spy ×4
(`ai-politics-bench-design.md` §7.3). Over 40 games, political block
decisions went from **0 of 45 viable** to **2 of 41 viable, and the bot
blocked both**.

So `blockPolitical` does what item 7 built it to do, demonstrated rather
than argued. But two of 41 is reachable, not measurable, and the reason
is **not** the deck:

`wouldSucceed` is `intercept >= stealth`, so one +1 retainer is enough.
The retainers are simply never in play — **employing one is an ACTION
scored at `playCard` (2) against a bleed at `bleedPrey` (12+), so the
policy bleeds instead, essentially always.**

A deck that cannot defend because the bot never plays its defensive
permanents is a POLICY problem, and no number of extra retainer copies
will fix it. That is a new candidate item, not a deficiency in this one.

### (c) shipped at ZERO, and why that is not fence-sitting

The actor-relation term was measured before being written, by recomputing
the argmax with and without it inside one run:

| table | block decisions | would flip |
| --- | --- | --- |
| default | 255 | **30 (12%)** |
| politics | 290 | **1 (0.3%)** |

So it is **live, not inert** — which is exactly the test that separates
`influenceUnlocks` (kept at 0, flips 9%) from `blockPressure` (deleted,
flips 0 at five times strength). It stays at 0 because live is not
better, and §8 measured this very function finding that two quite
different blocking policies give statistically identical games.

The 12% / 0.3% split across two tables is itself a warning: whatever the
term picks up is deck-shaped rather than general, and anyone turning it
on should measure both.

### BENCHED 2026-09-19 — no difference, and it stays at zero

The bench gained `--style`/`--weights` runs for exactly this kind of
question. Three mirror decks, two strengths, 240 games each:

| deck | weight | gap vs default | margin |
| --- | --- | --- | --- |
| Nosferatu | 3 | +0.017 | ±0.201 |
| Nosferatu | 8 | +0.017 | ±0.201 |
| Gangrel | 6 | −0.029 | ±0.194 |
| Brujah | 6 | −0.017 | ±0.194 |

All four inside the margin, straddling zero — and Nosferatu at 3 and at 8
is **identical to three decimals**, which says the extra strength flips
no further decisions.

So the term is upgraded from "live but unvalidated" to **"live and
benched neutral"**, and stays at 0. That is the `influenceUnlocks`
treatment and the criterion is the one this project already uses: delete
a weight that flips nothing, keep at zero one that flips decisions but
has not earned its place. This is the third time §8's finding — two very
different blocking policies give statistically identical games — has been
reproduced for this function.

## 6. Tests

- **The headline:** a fixture where a political action is announced and
  the bot has an idle blocker with sufficient intercept; assert it
  blocks. Then the same board with a hunt announced; assert it does not
  — **same seat, same blocker, different action**, which the old code
  could not distinguish.
- **`cardName` projection:** a trace asserting `view.action.cardName` for
  an action announced from hand, and `null` for a built-in bleed/hunt. The
  null case is the one that will be forgotten.
- **Do not regress the bleed path:** a lethal bleed at the bot still
  outscores a political action elsewhere. Assert the ordering directly,
  since the +50 cliff and the new weight now share a scale.
- **Negative space:** the block is not offered at all when stealth
  exceeds intercept — and the test must use a **hunt** to make intercept
  live, per the three-gates rule, or it will pass for the wrong reason.

## 7. Open question for the owner

**Is (b) worth the weight, given §5?** The honest position is that this
is a correctness fix to a function with a measured history of
indifference. Two readings are defensible:

- build (a) and (b) because a bot that cannot tell a referendum from a
  hunt is visibly wrong to anyone watching the table, regardless of win
  rate;
- build (a) only, and leave the weight until the politics work gives the
  bench a table where blocking a referendum can matter.

The doc recommends the first, on the grounds that you play the build and
find bugs by looking at the table — and this one is visible there.
