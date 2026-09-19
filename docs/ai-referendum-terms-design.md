# Referendum terms — the caller aims blind (2026-09-18)

**Status: designed, not built. Owner review before kernel code.**

Depends on `ai-seat-relationships-design.md`, and on
`ai-referendum-view-design.md` only for the polarity question in §3.

## 1. The defect

`chooseTerms` is answered **in offered order**. `src/ai/heuristic.ts`:

```ts
case "answerChoice":
case "chooseTerms":
  // WHICH answer still goes in offered order — reading them means
  // parsing card text, which would be a second model of the pool.
  return w.answerChoice;
```

Every terms option scores identically, so the seeded tie-break picks one
uniformly at random. **A bot that successfully calls Parity Shift chooses
its victim by coin flip**, and a bot that calls Kine Resources Contested
allocates the burn across the table at random — including onto seats it
had no reason to touch.

Terms are chosen on success only (p. 25's one exception, p. 27), so this
decision is reached exactly when the political action has already cost a
card, an action and a successful referendum. **It is the payload.**

It is 0.4% of real choices on the current table
(`ai-decision-profile-2026-09-18.md`), and that number is a measurement
of the fixture — see §6.

## 2. THE REASON THE COMMENT IS OUT OF DATE

The comment's premise is that scoring terms means reading card text. It
does not, and has not for some time: **the option params are already
structured.** Surveying every `chooseTerms` construction site in
`src/cards/effects/compile.ts`, the entire vocabulary is eight keys:

| key | value | what it names |
| --- | --- | --- |
| `seat` | one seat id | a Methuselah |
| `seats` | comma-separated seat ids | several |
| `chosen` | one seat id | the beneficiary, where a card has one |
| `alloc` | `Bob=2,Carol=1` | seats **and amounts** |
| `minion` | one minion id | a vampire or ally |
| `minions` | comma-separated minion ids | several |
| `clan` | a clan name | one of the pool's fourteen |
| `location` | a card id | a location in play |

Six of those eight resolve to a **seat** — directly, or through
`findMinion(view, id)`, or through the controller of a location. And
`alloc` carries the amounts as well.

So a terms scorer is a fold over at most eight keys, and it never touches
card text. The second-model-of-the-pool objection was correct when it was
written and is no longer the situation.

## 3. The design

```
score(termsOption) =
  Σ over (seat, amount) resolved from the option's params:
      amount × sign × relationWeight(relationTo(me, seat))
```

- **Seat resolution** is one helper per key, in one place, because "one
  question asked in two places will drift": `seat`/`chosen` are already
  seats; `seats` splits; `alloc` splits into pairs; `minion`/`minions`
  go through `findMinion` — **never `getMinion`**, because a derived read
  must be TOTAL and a minion can leave play between announcement and
  terms; `location` resolves through the controlling seat.
- **`amount`** is 1 for the keys that carry no number, and the parsed
  value for `alloc`.
- **`sign`** is the polarity problem, and it is the same one
  `ai-referendum-view-design.md` §5 raises. Without it, a burn and a boon
  score alike and the scorer aims a gift at its prey. **SETTLED (owner,
  2026-09-18): the primitive declares it**, so this scorer can rely on a
  sign being present rather than treating it as a bonus. The flat
  fallback in §5's negative-space test stays, for a primitive that has no
  polarity to declare — but it is no longer the expected path.
- **`clan`** resolves to no seat at all. It scores by counting vampires
  of that clan on the table, weighted by their controllers' relations —
  which is the honest reading of "choose an existing clan" (p. 49) and
  also handles the case the rulebook explicitly allows, where **no
  vampire of the chosen clan is in play**: the sum is then zero and the
  tie-break picks, which is correct rather than a bug.

**A cap on enumeration is required, not optional.** `search.ts` already
notes that one decision in this game can offer **2168 legal terms**
(Revolutionary Council). Scoring 2168 options is fine — it is a fold, not
a search — but any future code that does work per option must cap, and
this doc's scorer must stay O(1) per option so it never becomes the thing
that needs capping.

## 4. What it fixes that voting cannot

The vote scorer and the terms scorer are two halves of one competence and
neither substitutes for the other:

- **Terms** decide what the referendum DOES, and only the caller answers.
- **Votes** decide whether it happens, and everyone answers.

A bot that votes perfectly and aims randomly still fires its political
actions into the wrong seat. A bot that aims well and votes blind never
gets to.

## 5. Tests

- **The headline:** a three-seat fixture, bot calls Kine Resources
  Contested; assert the allocation lands entirely on its **prey**, not on
  a cross-table seat. Then rotate the seating and assert the choice
  follows the prey rather than the seat name — a test that would pass by
  accident if written only once.
- **Parity Shift with a beneficiary:** assert `chosen` is the bot itself
  and the allocation is on its prey. Two keys in one option, which is the
  case a single-key scorer would get half right — and half right is the
  worst state for a bug.
- **Minion-valued terms:** the target is a vampire controlled by the
  predator, not one of the bot's own. Plus the TOTAL-read case: a fixture
  where a named minion has left play between announcement and terms, and
  the scorer does not throw.
- **Negative space:** with polarity unavailable (`effect` absent), the
  scorer must fall back to flat and the tie-break must decide — it must
  NOT guess a sign. Assert the fallback explicitly, because a silent
  wrong guess here aims a burn at the bot itself.
- **Every case must not be a negative.** The lesson applies literally:
  a terms test suite with no passing positive has tested the fixture.

## 5.1 BUILT, 2026-09-18 (platform 0.10.70)

**The design's §3 formula was not what shipped, and the change is an
improvement.** §3 proposed a scorer that resolves the option's `params`
itself, with one helper per key. Item 3 had meanwhile built the signing
machinery — a per-card seat map — so the better move was the
`richer-options-design.md` §1 pattern: **the engine attaches the resolved
deltas to the option** and the AI parses nothing.

- **`chooseTerms.perSeat`** — signed pool deltas, positive means gains.
  Backfilled CENTRALLY where the terms decision is raised, not at the
  thirteen construction sites, so a handler cannot forget it. Same
  treatment `answerChoice.card` already gets.
- **`resolvePerSeat` moved to `state.ts`** and is now shared by the view
  projection (the terms the caller HAS chosen) and the terms decision
  (each CANDIDATE's params). Two callers, one helper — the drift here
  would have been a sign error, which is the one mistake this whole
  mechanism exists to prevent.
- **`scoreTerms`** in `heuristic.ts` reuses `poolWeight` and `oustWeight`
  from the vote scorer, so aiming a referendum and voting on one cannot
  disagree about what a seat is worth.

An option the engine could not price keeps the old flat score and falls
to the seeded tie-break, deliberately: an unpriceable card must not end
up worse off than before.

### What the real games showed

20 games on the politics table: **16 terms decisions with a real choice,
15 of them priced.** The bots aim at the prey, and take the smallest
share when forced to include themselves.

**One case in 20 games takes pool off the caller, and it is forced:** a
heads-up table, where "allocate among two or more Methuselahs" leaves no
allocation that excludes you. The bot ate 1 and gave its opponent 3,
which is the best available answer. It is now a test
(`tests/ai/referendum-terms.test.ts`, "when it cannot avoid itself"),
because it is the case a scorer written only against three-seat fixtures
would get wrong.

**A measurement instrument needs a negative control.** A first probe
reported the bot aiming at ITSELF in 7 of 15 decisions, which would have
been a serious regression. It was the probe: it scored "the seat with the
most negative delta" and counted a Parity Shift *gift to self* — a
positive delta, and the correct play — as a hit. The second probe, which
asked the narrower question "is my own delta negative", found one case.
**The alarming number was the instrument, not the policy**, which is the
same lesson §5–§8 of `richer-options-design.md` keeps paying out.

## 6. Measurement

13 `chooseTerms` decisions in 20 games, and **that number is about the
decks**, not about VTES — one seat of three holds three political cards.
On a politics deck this is a decision the bot reaches several times a
game, each time with the whole payload of a political action riding on
it. `ai-politics-bench-design.md` first.

## 7. Open question for the owner

**The `clan` key.** A clan boon or a clan lock (`refClanBoon`,
`refLockClan`) names a clan, and p. 49 says you must choose an existing
clan **even if no vampires of that clan are in play**. The design scores
by who controls vampires of that clan.

That is right for a lock — you lock the clan your predator plays. It may
be wrong for a boon, where the interesting choice at a real table is
sometimes a clan nobody plays, precisely so the boon does nothing.
Deliberately choosing a dead term is a legitimate VTES play and this
scorer cannot express it. Worth your call on whether it should.
