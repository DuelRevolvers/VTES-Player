# Reading the table's ash heaps (2026-09-18)

**Status: designed, not built. Owner review before kernel code.**

Depends on nothing. The most speculative item on the AI list, and
deliberately written so a "no" is easy.

## 1. The observation

`PlayerView.seats[].ashHeap` is `CardInstance[]` **in full, for every
seat**, and the projection says why:

> The discard pile, IN FULL for every seat: p. 16 says the ash heap "can
> be examined by any Methuselah at any time", so it is the one zone this
> projection never masks.

`redactFor` passes it through the spread unmasked, with a comment saying
that is deliberate. It is the single richest piece of open information at
a VTES table.

**`HeuristicAgent` never reads it.** `SearchAgent` reads only its **own**,
and only to subtract played cards from its own deck list for deck
tracking (`src/ai/search.ts`). Every opponent's ash heap is ignored by
both.

## 2. What a human does with it

A VTES player watching an ash heap fill up learns what a deck DOES:

- this predator has shown two Deflections, so my bleed at 1 will be
  bounced and my bleed at 4 is the one to make;
- this seat has burned three combat cards and no stealth, so their block
  is a real threat and their action is not;
- this seat's ash heap has no reactions in it at all after four turns,
  which is itself information.

This is not card counting in the hidden-information sense. It is reading
a public zone the rulebook explicitly makes public. **It is the one place
the AI could get materially better informed without touching the boundary
at all**, which is why it is worth writing down even if it is not built.

## 3. Why it is nevertheless the weakest item on the list

Three reasons, stated plainly so this does not get built on enthusiasm.

**(a) It fails the §8 test almost everywhere.** "My predator plays
Deflection" is a property of a SEAT, not of an option. In a bleed
decision the predator's tendencies are identical across every bleed
option in the list, so by the established law it cannot change the
argmax. The places it could matter are the narrow ones where options name
different seats — which is the same short list the politics docs already
cover.

**(b) The inference needs card knowledge.** "Two Deflections in the ash
heap" only means something if the agent knows what a Deflection does,
which is a second model of the pool — the thing every other doc in this
set refuses to build. Reading the ash heap generically ("12 cards, 4
combat") is cheap and says much less.

**(c) An ash heap is not a deck.** Cards return from it (the ash-heap
resource mechanics), and a deck of 90 shows you very little by turn 6.
The signal is real and thin.

## 4. If it is built anyway — the shape that survives the objections

The version that does not need a card-name table: **count by TYPE and
DISCIPLINE**, both of which the registry already gives per card, and both
of which are structural rather than semantic.

```ts
/** What a seat has SHOWN, from their public ash heap. Counts only. */
interface SeatProfile {
  byType: Record<string, number>;       // Action, Reaction, Combat, …
  byDiscipline: Record<string, number>; // what they have actually paid with
  total: number;
}
```

Two uses that pass the §8 test because they vary within one option list:

- **Which seat to aim a referendum term at** — prefer the seat whose ash
  heap shows fewest Reactions, since a boon or a burn aimed there is less
  likely to be answered. This composes with
  `ai-referendum-terms-design.md` and is a tie-break, never a primary term.
- **Whether a block is worth attempting against a given ACTING seat** —
  a seat that has shown a lot of Combat has an unpleasant answer waiting.
  Same caveat as `ai-block-action-value-design.md` §5: `scoreBlock` has a
  measured history of indifference.

**What it must not become:** a per-card threat table, or anything that
tries to estimate what is left in a deck other than the agent's own. The
agent knows its own deck by owner ruling (2026-09-06) — composition,
never order — and knows nobody else's, because deck lists are private.

## 5. Tests

- A `SeatProfile` unit test over a hand-built ash heap, asserting counts
  by type and discipline.
- **The boundary test is the important one:** the profile must be built
  from `view.seats[].ashHeap` only. A test that the profile is identical
  when computed from `viewFor(state, a)` and `viewFor(state, b)` for the
  same target seat — because a public zone looks the same from every
  chair, and if it does not, something is being read that should not be.
- `tests/ai/information-boundary.test.ts` green and unchanged.
- **Negative space:** an empty ash heap yields a zeroed profile that is
  used as "no information", not as "no reactions". Those are different,
  and conflating them is the "empty for the wrong reason" failure in its
  purest form — turn one, every ash heap is empty, and a bot that reads
  that as "nobody can block" would walk into every block at the table.

## 5.1 MEASURED, 2026-09-19 — and NOT BUILT

The two uses §4 proposed were measured before any code was written, over
40 games on both tables. **They came out opposite ways.**

### Use 1 — the terms tie-break: DEAD, and not marginally

| | |
| --- | --- |
| terms decisions with a real choice | 28 |
| of those, TIED at the top after item 4's scorer | 15 |
| ties an ash-heap reaction count would separate | **0** |

Zero of fifteen. The tie-break has nothing to break: when the terms
scorer ties, the candidates' victims have identical reaction counts
shown. This is the `blockPressure` outcome — a term that provably cannot
change a decision — and this project deletes those rather than shipping
them at zero.

### Use 2 — the block term: LIVE

Penalising a block against a seat whose ash heap is combat-heavy, by
share of combat cards:

| weight | block decisions | would flip |
| --- | --- | --- |
| 2 | 532 | 33 (6.2%) |
| 6 | 532 | 41 (7.7%) |
| 12 | 532 | 112 (21.1%) |

That is the `influenceUnlocks` situation — real, live, unvalidated — and
the data is there to read: the acting seat's ash heap is non-empty in 476
of the 532 decisions, mean size 4.4.

### Why it is still not built

**The projection cannot see card types.** `PlayerView.seats[].ashHeap` is
`CardInstance[]`, which is `{id, name}` — no types, no disciplines. The
AI cannot classify a discarded card without a registry, and putting a
registry in the AI is the second model of the card pool that every doc in
this set refuses.

So building use 2 requires one of:

- **a registry in `viewFor`**, which takes `(state, seat)` and is called
  from the transport and from tests — a signature change rippling well
  beyond this feature; or
- **recording the type on the card as it enters the ash heap**, which is
  the house pattern and has a direct precedent (`CardInstance.capacity`
  is recorded exactly that way, for exactly this reason — "a zone records
  what today's readers need, and is wrong for tomorrow's"). But cards
  reach the ash heap from many sites, and that is a "one question asked
  in N places" change for a term that would ship at 0.

**Weighed against a 6% flip rate on a function §8 measured as
indifferent — where two quite different blocking policies produced
statistically identical games — that is not a trade worth making today.**
Item 7 sharpened the point further: 0 of 45 political block decisions
even had a block that could succeed, because stealth and intercept gate
the option long before any weight prices it.

### What would change the answer

- A deck with real intercept in it, so blocks are live more often
  (the same follow-up `ai-block-action-value-design.md` §5.1 asks for).
- Any other consumer wanting card types out of the ash heap, at which
  point the recording change pays for two things instead of one.

**The measurement is the deliverable here.** Item 10 is closed as
measured-and-declined rather than left open, so the next person to notice
that the richest public zone in the game is read by nobody finds the
numbers and the blocker rather than rediscovering both.

## 6. Recommendation

**Build it last, or not at all.** Every other doc in this set has either a
measured defect behind it (voting, combat range, terms) or is a pure
information projection with an obvious consumer. This one has a real
opportunity and three structural reasons to expect little.

It is written down because the asymmetry is striking — the richest public
zone in the game, read by nobody — and because the next person to notice
it should find this doc rather than rediscover the objections.

## 7. Open question for the owner

**Is "this seat has shown two Deflections" the kind of thing you want the
bots doing at all?** It is unambiguously legal and it is what a strong
player does. It is also the point at which the bots start to feel like
they are watching you, which is a different experience from the current
ones — and you are the one who plays the build.
