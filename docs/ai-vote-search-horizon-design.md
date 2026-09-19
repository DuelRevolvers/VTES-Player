# The search agent is structurally blind to votes (2026-09-18)

**Status: designed, not built. Owner review before kernel code.**

Depends on `ai-vote-scoring-design.md` (which gives the fallback a real
opinion to fall back to). Relevant only to `SearchAgent`, which is guarded
and not the default.

## 1. The defect

`SearchAgent` evaluates a move by playing it and looking at the position:
clone, apply, evaluate, keep the best. Its value function reads victory
points, pool, prey's pool, predator's pool, board, uncontrolled counters,
blood, hand size, ousted.

**A cast vote changes none of those.** Casting is an effect that rewinds
into the impulse cycle; the referendum does not resolve until polling
closes at quiescence and the tally is taken. So a one-ply search on a
vote evaluates the position *immediately after the cast* — before
anything the referendum does has happened.

Both directions therefore evaluate identically, the lookahead term
contributes nothing, and the choice falls entirely through to the blended
policy opinion — which, today, is the 70/0 "yes to everything" of
`ai-vote-scoring-design.md`.

**The search agent is not merely no better at voting than the policy. It
is exactly the policy, with the search's cost paid for nothing.**

## 2. Why this is not fixed by searching deeper

The obvious answer — search more plies — is the wrong one here, and the
reason is in `ai-v2-design.md` §6:

> it cannot know what an opponent holds, so it cannot search their
> replies. It looks one ply — its own move — and evaluates. Deeper search
> needs determinization (guessing the hidden cards).

Polling is **the other seats' decisions**. A two-ply search across polling
is a search over opponents' replies, which is the unsolved part of AI v2
and needs sampling hidden cards. This doc does not propose that.

## 3. The design: a horizon, not a depth

The insight is that **the horizon is the wrong shape, not the wrong
size**. One ply is the right amount of *my own* decision; the problem is
that a vote's consequence lies past a boundary the search does not
recognise.

So: for a `castVote` decision specifically, **evaluate at the tally
rather than at the cast.**

```
for each vote option:
  clone
  apply the cast
  resolve the referendum under a stated assumption about the
    remaining unspent sources        <- §4
  evaluate the position after the tally
```

This is not a deeper search. It is the same one ply, measured at a point
where the value function can see something. The engine can do this — a
referendum resolves deterministically once the votes are fixed, and the
whole state is clonable by construction (architecture principle 2).

## 4. THE ASSUMPTION, which must be stated and not hidden

Resolving the referendum requires deciding what the unspent sources do.
Three candidates:

**(a) Nobody else votes.** Simplest, deterministic, and systematically
optimistic about a referendum I support.

**(b) Everyone else votes against me.** The conservative reading, and the
same assumption `ai-vote-economy-design.md` §4 recommends for its
decided/live test. Consistency across the two is worth something in
itself: one assumption, two consumers.

**(c) Every other seat votes by the §3 formula of
`ai-vote-scoring-design.md`, applied from their seat.** The most
realistic, and it needs **no hidden information**: the formula reads only
public facts (the referendum's terms, seat relations, pool totals), so
computing it from another seat's chair is legitimate — it is a model of a
rational opponent, not a peek at their hand.

**Recommendation: (c), with (b) as the fallback when the referendum's
polarity is unavailable.** (c) is the one that makes the search *worth
running* — it is the first opponent model in this project that does not
require determinization, because it models a decision made from open
information.

That is a genuinely interesting property and worth stating: **polling is
the one place in VTES where an opponent's decision is made from public
facts.** Everywhere else, modelling their reply means guessing their
hand. Here it does not.

## 5. Scope, and the guard

- **`SearchAgent` only.** `HeuristicAgent` is the default and must not
  acquire a referendum resolver; a policy that simulates is no longer a
  policy.
- **Cost:** one clone and one referendum resolution per vote option. Vote
  options are few (two per source), so this is cheap in the absolute —
  but `maxOptions` exists because "one decision in this game can offer
  2168 legal terms", and any new per-option work must respect it.
- **Determinism:** the resolution must run on the search's own seeded
  stream, or two identical positions will evaluate differently and
  replays become a lie (architecture principle 2).

## 5.1 BUILT, 2026-09-19 (platform 0.10.75) — assumption (c), owner ruling

What shipped, and the first part was not in the design:

- **`settle` now counts a REFERENDUM as in flight.** It checked only
  `action`, `combat` and `cardPlay`, so after a cast vote it returned
  immediately and the position was evaluated *at the cast*. The horizon
  was not merely one ply — it stopped short of the tally entirely, which
  is why both directions valued identically.
- **`settleChoice`** drives the simulated table: pass everywhere, except
  another seat's polling decision, where it votes by the same policy
  formula from `viewFor(sim.state, thatSeat)`.
- **`modelledVotes`**, a public counter, because a model that never ran
  looks exactly like one that ran and changed nothing.

### Why the opponent model stays honest

Three properties, all testable, and the middle one is the strong one:

1. it runs the **same formula** the seat itself would use — one vote
   policy, not two;
2. the state it reads is **already redacted for the SEARCHER**, so a
   modelled opponent is given no more than the searcher can see and
   usually less (their own hand is blanked to them). **The model can only
   ever be more ignorant than the real player, never better informed**,
   which is the safe direction for a wedge into opponent modelling;
3. it models only VOTES, so nothing here can invent a reaction out of a
   hand nobody can see.

### Two test failures, both the test rather than the code

**The fabricated decision.** The first version hand-built a
`DecisionPoint` with `seq: 1` and synthetic vote options. `simulate`
refuses to search a decision the cloned engine is not also offering — "or
we would be searching a different game than the one being played" — so
every simulation returned null, the lookahead contributed nothing, and
**the tests passed anyway on the policy alone**. They now take the
decision from a real `VtesEngine`, and the fixture gives Alice a title so
she has a vote source at all.

**The crippled-policy test, which §6 asked for, does not isolate what it
appears to.** Inverting the policy's vote weights to make it vote
backwards also inverts the OPPONENT MODEL, because they are the same
object: the modelled caller then votes against her own referendum,
Alice's vote stops mattering, and the agent correctly passes. A
green-looking failure that says nothing about the horizon. Splitting them
would mean a second vote policy to keep in step; the `modelledVotes`
counter pins the mechanism directly and costs nothing. Recorded in the
test file so it is not rewritten.

### What is NOT claimed

No strength measurement. `SearchAgent` is guarded and not the default,
and this changes the horizon for **every** simulation that now runs
through a referendum — including calling a political action, which now
evaluates its payoff rather than its cost. That is principled and
unmeasured, and it should be benched before the agent is considered for
anything.

## 6. Tests

- **The headline:** a position where voting `for` ousts the search
  agent's prey. Assert `SearchAgent` votes `for`, and — the important half
  — assert it votes `against` in the mirrored position where the same
  referendum would oust the agent itself. The old agent gives the same
  answer to both.
- **The lookahead must actually be doing it:** a position where the
  policy blend alone would answer one way and the tally-horizon answers
  the other. If no such position can be constructed, the feature is
  inert and that is a finding, not a test to weaken.
- **Assumption (c) is not cheating:** assert the resolver, when modelling
  another seat, is given nothing but that seat's redacted view. This
  belongs in `tests/ai/information-boundary.test.ts`'s neighbourhood and
  should be written as a boundary test, not as a search test.
- **Determinism:** same seed, same position, same answer, twice.

## 7. Open question for the owner

**§4, assumption (a) / (b) / (c).** The recommendation is (c).

The thing worth your attention is that (c) quietly introduces the first
**opponent model** in the project. It is a defensible one — it uses only
what a person at the table can see — but it is a step past "score the
options in front of me", and `ai-v2-design.md` §6 named opponent
modelling as the unsolved part. This is a narrow, legitimate wedge into
it. Whether you want that wedge driven in at a referendum is your call
rather than a technical one.
