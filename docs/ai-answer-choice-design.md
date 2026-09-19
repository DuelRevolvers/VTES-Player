# `answerChoice` — the other decision answered in offered order (2026-09-18)

**Status: designed, not built. Owner review before kernel code.**

Depends on nothing. Shares its root cause with
`ai-referendum-terms-design.md`, and the two should be read together.

## 1. The defect

Same two lines as the terms defect, in `src/ai/heuristic.ts`:

```ts
case "answerChoice":
case "chooseTerms":
  // WHICH answer still goes in offered order …
  return w.answerChoice;
```

**1.7% of real choices** (`ai-decision-profile-2026-09-18.md`) — 49
decisions in 20 games, more than `usePress` and `chooseTerms` combined.

The comment beside it records a real and hard-won fix: this used to score
0 against `pass` at 0.5, so the AI **declined every optional payoff in the
game** — Cave of Apples, Dead Pool, Hunting the Beast, the rush-outcome
riders. That fix was about *whether to answer*. **Which answer to give is
still a coin flip**, and the frames where it matters most are the ones
where every answer is bad and one must be taken anyway: an unlock toll, a
p. 7 discard-down, a cost addressed to a victim.

So the bot answers "which of my vampires pays this" at random.

## 2. The information that is already there

The option carries more than the terms option does:

```ts
{ kind: "answerChoice"; label: string; params: Record<string, string>;
  /** The NAME of the card this answer picks, when it picks one. */
  card?: string }
```

`card` was added for the search agent — "a search's candidates are card
ids in a zone the viewer cannot read … the engine is the only thing that
knows which card an option is about" — and is **backfilled centrally in
`choiceOptionsFor` rather than by each handler, so a handler cannot
forget it**. The policy never reads it.

`params` is the same structured vocabulary the terms scorer walks:
minions, seats, cards, counts.

## 3. The design

**Do not build a card-name table.** Build three structural rules, in
descending confidence. Each is about what the answer NAMES, never about
what the card says.

**(a) When the answer names one of MY minions and the frame is a cost,
pick the cheapest.** An unlock toll or a blood cost addressed to my side
should come off the vampire that can best afford it — highest blood, and
never one at 1 blood who then cannot pay tolls or mend (p. 31), which is
a judgement `scoreBlock` already makes for blockers and which is the
same judgement here.

**(b) When the answer names a CARD of mine, prefer to spend the least
useful.** A discard-down (p. 7) should shed what the board cannot use.
There is already a built-in expressing exactly this preference —
`burnOptionDiscard` is scored at `w.discard + 1` because it is "a card no
minion of ours can use, swapped for a fresh draw at no cost" — so the
notion exists in the file and is simply not reachable from here. Reuse it
rather than inventing a second spelling; **one question asked in two
places will drift.**

**(c) When the answer names another seat or their minion, use the
relation.** Same helper as everything else
(`ai-seat-relationships-design.md`). A choice that hurts somebody should
hurt the prey or the predator.

Everything not covered by (a)–(c) keeps `w.answerChoice` and falls to the
seeded tie-break, which is the current behaviour and is correct as a
default. **The scorer must degrade to today's behaviour, not to zero** —
scoring an unrecognised choice at 0 would resurrect the exact bug the
comment records.

## 4. Why this is a different risk from the terms scorer

The terms scorer walks an **eight-key vocabulary that is enumerable** —
every construction site is in one file and can be surveyed. `answerChoice`
params are raised by **many handlers across the bespoke tail**, and there
is no guarantee the key set is closed.

That has two consequences the design must respect:

- **The scorer must be total over unknown keys**, falling through to the
  default rather than throwing or guessing.
- **It must not assume a key means the same thing in two cards.** A
  `minion` param in one frame is a victim and in another is a
  beneficiary. Which is why (a) is scoped to *my own* minions and a
  *cost* frame, and why the polarity problem from
  `ai-referendum-view-design.md` §5 shows up here too, less tractably.

**A vocabulary kept in a regex is a list nobody greps** — the same lesson
applies to a vocabulary kept in a scorer's `switch`. If this is built, the
key set it recognises should be asserted by a test that walks the
registry, so a new key arriving in a card wave is visible rather than
silently defaulted.

## 4.1 BUILT, 2026-09-19 (platform 0.10.74)

**The design's §4 worry — that the key set might not be closed — was
answered by measuring it rather than reasoning about it.** Over 40 games
there are **106 answerable choice decisions**, and their param key sets
are four, not many:

| key set | decisions | what it is |
| --- | --- | --- |
| `left+pay+pick` | **53** | Smiling Jack's unlock toll: burn 1 pool, or 1 blood from a named vampire |
| `card` | **45** | the p. 7 discard-down |
| `answer` | 5 | a yes/no |
| `minion` | 3 | names a minion |

So two families are 98 of 106, and both were coin flips. (a) and (b)
shipped and cover them.

### (a) The currency choice

Pool is life (p. 4), blood is fuel — so blood, unless the vampire is at
1 or less ("a vampire with no blood left to mend goes to torpor", p. 31;
one at 0 MUST hunt, p. 21), or has left play between the frame opening
and the decision. **Measured after: 54 toll choices, 35 paid in blood
and 19 in pool** — discriminating rather than blanket, which is the
point.

### (b) The discard, and the bug the measurement caught

Shed the most redundant card: copies the deck was BUILT with (the
owner's 2026-09-06 ruling gives an agent its own deck composition) plus
copies still in hand, minus one so a singleton is not "redundant".

**The first version fired on ZERO of 45 discard decisions.** It keyed off
`answerChoice.card`, the backfilled card NAME — and a discard-down names
its card by INSTANCE ID in `params.card` instead. The scorer now resolves
the id against the viewer's own hand, which p. 7 lets them read in full.

After the fix: **48 card-naming decisions, 30 of them all-equal** (every
candidate equally redundant, so the seeded tie-break decides, which is
correct) **and 18 with a real preference — all 18 taken.**

This is the "empty for the wrong reason" lesson in its purest form. Every
scenario test passed; the feature did nothing in a real game; and only
counting how often it FIRED said so.

### (c) NOT built, and now for a measured reason rather than a cautious one

§3(c) would score a choice naming another seat's minion by relation. It
is **3 decisions in 40 games** — the rarest family — and the one that
needs a polarity the frame does not carry, where a wrong sign aims a
benefit at your own prey. Rarest and riskiest is an easy call.

`deckList` is the deck AS BUILT rather than what remains; `search.ts` has
to subtract the ash heap and the table to get a remainder. Copies-built
is monotone with copies-left, needs no second reconstruction of the deck,
and "I built four of these" is exactly why one is cheap to lose — so the
cruder signal is the right one here, and the code says so.

## 5. Tests

- **(a):** a fixture with two of the bot's vampires, one at 1 blood and
  one at 6, and a toll addressed to the bot. Assert the 6 pays. Then swap
  the blood values and assert the choice follows the blood, not the
  position in the list — the rotation test, because a single-orientation
  test passes by accident half the time.
- **(b):** a discard-down where one card in hand is unusable by the
  board. Assert that one goes.
- **Regression, and this is the important one:** the optional-payoff case
  the comment records. A Cave of Apples-style optional frame must still be
  ANSWERED rather than passed. If this test does not exist today, it
  should be written first, before the scorer, so the fix that is already
  in the file is nailed down before anything moves.
- **Unknown key:** a synthetic choice frame with a param key the scorer
  does not recognise; assert it still returns a legal option id and scores
  at the default.
- **Every case must not be a negative** — at least one case where the
  scorer's answer differs from the offered order, or the suite is testing
  the tie-break stream.

## 6. Open question for the owner

**How far to take (c).** A choice that names another seat's minion is
sometimes a gift and sometimes a punishment, and the frame does not say
which. Without polarity the relation weight has an unknown sign, and a
wrong sign is worse than no rule: the bot would systematically aim
benefits at its prey.

Two safe readings: build (a) and (b) only, which never need a sign
because they are scoped to my own side; or have choice frames declare
polarity the way referendum primitives now do. The second is more work in
the engine and makes both docs' problems go away at once.

**The ground has shifted in favour of the second.** The owner ruled on
2026-09-18 that referendum primitives declare their polarity
(`ai-referendum-view-design.md` §5(a)). Extending the same declaration to
choice frames is then a consistent move rather than a new idea — and the
argument that won it there wins it here: the alternative is a card-name
table, and a wrong sign is worse than no rule.

The difference that keeps this question open: referendum primitives are a
small, enumerable set in one file, and choice frames are raised across the
bespoke tail (§4). Declaring polarity there is a bigger surface and a
longer tail of cards to revisit. **This is a scope question now, not a
design one.**
