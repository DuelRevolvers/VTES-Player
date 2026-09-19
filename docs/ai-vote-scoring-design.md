# Voting — the bots say yes to everything (2026-09-18)

**Status: designed, not built. Owner review before kernel code.**

Depends on `ai-referendum-view-design.md` and
`ai-seat-relationships-design.md`. Measured in
`ai-decision-profile-2026-09-18.md`.

## 1. The defect, measured

20 games, all seats `HeuristicAgent`, counting the option the policy
actually returned:

```
votes cast:  FOR 70   AGAINST 0
votes on a referendum called by ANOTHER seat: 33, of which FOR: 33
```

**Not a tendency — a certainty.** `src/ai/heuristic.ts`:

```ts
case "castVote":
  return (o.inFavor ? w.voteOwn : w.voteAgainstOthers) + o.count * 0.5;
```

`voteOwn` is 6, `voteAgainstOthers` is 4, and `o.count` is the same for
both directions of the same source. So "for" beats "against" by exactly 2
in every position that has ever occurred or ever could. The bots vote in
favour of referendums that burn their own pool, and did so 70 times out
of 70.

The comment above those weights says "Vote with your own referendum,
against everybody else's." That branch does not exist, and it could not:
nothing in `DecisionPoint` or `PlayerView` says who called it. See
`ai-referendum-view-design.md` §2.

**The worst case is not hypothetical.** A referendum that takes my prey
to zero hands ME a victory point and 6 pool (§2 of
`ai-seat-relationships-design.md`, `processOusts`). Today the bot's
reasoning for voting yes to that is character-for-character the same as
its reasoning for voting yes to one that ousts itself.

## 2. WHY THIS ONE IS WORTH BUILDING WHEN PRESSURE WAS NOT

`richer-options-design.md` §8 established a law, and it is the reason
four earlier ideas shipped nothing:

> A policy is an argmax over one option list. A term that does not VARY
> across that list cannot change the choice.

`blockPressure` and `bleedPressure` failed it structurally — my pool is
the same for every blocker in the decision, the prey's is the same for
every bleed.

**A vote is the case the law was waiting for.** Measured over the same 20
games: **70 of 70 vote decisions offered both `inFavor: true` and
`inFavor: false` from the same source.** The two options are *opposites*.
Any term that evaluates the referendum at all takes different values on
them, by construction. There is no distribution to hope for and no
strength of weight to tune into existence — the fork is there whenever
the source can go either way.

### 2.1 CORRECTION, found while building the politics table (2026-09-18)

That "70 of 70" was a true measurement and an **over-general claim**, and
the politics table falsified it the first time it ran: **30 of 31**, with
one exception.

The exception is exactly the case §7.2 below raises as an open question,
which is reassuring about the question and embarrassing about the claim.
The one-way source was `grantAgainst` — a **directed vote grant** of 3
votes on a Parity Shift, the Protected District shape: "+N votes AGAINST
the referendum" is bucketed by direction in `voteGrants` and may only be
cast that way (`polling-votes-design.md` §3).

The default playtest table had no such card reaching play, which is why
the first measurement saw no exception. **A table with no politics in it
was also a table with no directed grants in it** — the fixture was
flattering the claim as well as hiding the defect.

What survives, and it is the part the design rests on:

- **For a flexible source the fork is real and universal**, and the §8
  argument is unchanged.
- **For a directed grant the decision is not for-or-against at all** — it
  is cast-or-decline. The scorer must handle it as such, which is now a
  requirement rather than a subtlety: the "against" side of a directed
  grant has no "for" to be compared with, so scoring it as one half of a
  fork would compare it against `pass` by accident.

`tests/ai/politics-table.test.ts` pins the corrected statement per SOURCE
rather than per decision, and asserts that **every** one-way source is a
grant — so the day some other kind of source becomes one-way, a test says
which, instead of a number quietly shifting.

**Re-measured 2026-09-19, per SOURCE over 20 games each:** the default
table has **139 forking sources and 0 one-way**; the politics table has
**284 forking and 4 one-way**. The correction holds in both directions —
one-way sources are real, and they are rare and confined to grants.

This is the strongest structural case on the AI list, and it is the
reason politics is proposed before anything else in the stack.

## 3. The design

Replace the two-constant lookup with: **price the referendum, then take
the side of the price.**

```
value = Σ over seats named by the referendum:
          effectOnSeat(seat) × relationWeight(relationTo(me, seat))
score(inFavor)  =  +value
score(against)  =  −value
```

**`effectOnSeat` IS THIS ITEM'S WORK, and it is more than a field read.**
Item 1 shipped `view.referendum.effectKind` (burn / gain / other,
declared by the card) and the raw `view.referendum.terms`. It
deliberately did **not** ship a per-seat pool delta: a generic parse over
the terms keys was built and cut when Parity Shift proved the same keys
carry opposite signs on different cards — "allocate 3 of **their** pool
among 1 or more other Methuselahs" means the chosen seat loses and the
allocated seats gain, the reverse of an allocate-burn
(`ai-referendum-view-design.md` §5.1).

So this item must turn `effectKind` + `terms` into signed per-seat
deltas **with per-card knowledge**, and the declaration belongs beside
the polarity one — a card that already says *which way* should say
*which key* in the same place. Relation weights come from the sign table
in `ai-seat-relationships-design.md` §2.

Three things sit on top of it, and each is a rule rather than a knob:

**(a) The oust cliff, which is the one real discontinuity.** If the
referendum would take a seat to zero pool:

- **my prey** — this is a VP and 6 pool for me. A large positive, of the
  same order as the `lethal` bonus a bleed gets (+25 today).
- **me** — `selfOustGuard` territory, and for the same reason it dominates
  everything else in the file. A vote for a referendum that ousts me must
  be unreachable, not merely unattractive.
- **my predator** — good but not scoring: their predator takes the VP.
- **cross-table** — mild.

The cliff is legitimate here for the reason a gradient was not legitimate
in §8: it is **evaluated per side of the fork**, so it flips a real
choice.

**(b) The caller's own referendum is NOT automatically worth voting
for.** It is worth voting for if and only if the terms are good for me,
which the same formula answers. The `voteOwn` intent survives as a small
tie-break — I paid a card and an action for this, so a genuinely neutral
one should still pass — and nothing more.

**(c) A blood-hunt referendum is a different question and gets its own
branch** (p. 35): it burns a vampire, not pool, and the relation that
matters is who controls the diablerist. Pricing it through `perSeat`
would be pricing the wrong thing. If `view.referendum.variant` is
`"bloodHunt"`, score by the controller of `bloodHuntTarget`.

## 4. What this deliberately does NOT do

- **It does not parse card text.** Everything above reads structured
  fields. The moment a vote scorer needs a card-name table it has become
  a second model of the pool, which is the thing `heuristic.ts` refuses
  to be (`ai-referendum-view-design.md` §5(b)).
- **It does not decide whether to spend the vote at all.** That is
  `ai-vote-economy-design.md`, and it is deliberately separate so the two
  can be measured apart.
- **It does not model deals.** Nobody at this table can talk.

## 5. Tests

Trace tests in `tests/cards/`, using the option-id convention
`vote:<source>:for|against`:

- **The headline positive:** a Kine Resources Contested aimed at the
  bot's prey; assert the bot casts `for`. Then the same referendum aimed
  at the bot; assert it casts `against`. **Same card, same seat, opposite
  answers** — which is the assertion that the old code could not have
  passed under any weights.
- **The oust cliff, both signs:** prey on 2 pool with a 2-point burn —
  assert `for`. Bot on 2 pool with a 2-point burn — assert `against`, and
  assert it holds even when the bot called the referendum itself.
- **Negative space:** a referendum whose terms name nobody scores flat,
  and the choice falls through to the seeded tie-break rather than
  silently preferring `for`.
- **A blood hunt** is scored by §3(c) and not by `perSeat`.
- The **whole-table** guard: after this lands, re-run the 20-game probe
  and assert the for/against split is no longer 70/0. A split that stays
  degenerate means the scorer is reading an empty `perSeat` — the "empty
  for the wrong reason" failure, which this test is specifically shaped
  to catch.

## 5.1 BUILT, 2026-09-18 (platform 0.10.69)

**The 70/0 is gone.** Measured the same way, 20 games per table:

| table | before | after |
| --- | --- | --- |
| `playtest-decks.json` | FOR 70, AGAINST 0 | **FOR 26, AGAINST 44**, 3 declined |
| `playtest-decks-politics.json` | — | **FOR 82, AGAINST 60**, 9 declined |

**Re-measured 2026-09-19 (0.10.77)**, after items 5–9 changed other
decisions and after the politics table was augmented — 20 games each:

| table | for | against | declined |
| --- | --- | --- | --- |
| default | 37 | 32 | 0 |
| politics | 77 | 51 | 3 |

The split moves between runs because a changed decision anywhere changes
every position after it; what does not move is the property this item
exists for — **both directions occur, on both tables.** The exact ratio
was never the claim.

The "declined" column is new and is the directed-grant rule working: a
source that can only push one way is left unspent when that way is the
wrong way.

What shipped beyond the scorer:

- **`referendumSeatMap`** in `compile.ts` — the signing work that moved
  here from item 1. Derived from the primitive for `refAllocateBurn`
  (losers `alloc`, plus `chosen` as gainer where the card has a
  `beneficiary`), `refChooseSeatsBurn` (losers `seats`, `each: base`) and
  `refBurnSeatOrLocation` (losers `seat`, `each: poolBurn`), and declared
  on the spec for Parity Shift, whose signs are reversed.
- **`view.referendum.perSeat`** — signed deltas, positive means that seat
  GAINS. Absent where the terms name no seats.
- `scoreVote`, `referendumValue`, `poolWeight`, `oustWeight` in
  `heuristic.ts`, and nine new weights.

### Three things settled in the building

**The oust cliff must read the NET.** Camarilla's Iron Fist can name one
seat on both sides — chosen beneficiary AND part of the allocation — so a
cliff that fired on the first negative term it met would guard against an
oust that a gift had already prevented. Both directions are tested.

**A directed grant is scored cast-or-decline**, using `dp.options` to see
whether the same source offers the other direction. `DecisionPoint`
carries the whole option list, so the policy can ask "is this a fork"
without any new plumbing.

**The magnitude is a floor, the sign is exact.** `refChooseSeatsBurn`'s
`capBonus` — Empires Fall's extra 3 against a big vampire — depends on
what a seat controls, so it is not counted. That is the right way round:
a scorer that under-rates a burn still votes for it, where a wrong sign
votes backwards.

### The honest limit

**Only 9 of the 22 pool-moving political actions name seats in their
terms.** The other 13 charge the table from the BOARD — Anarch Salon per
Sabbat vampire, Tithings per seat with more pool than the caller,
Diversity per distinct clan — and for those `perSeat` is absent and the
bot falls back to the weak prior in §3(b). Pricing them means walking the
board with the primitive's parameters, which is a real piece of work and
is **not** done. It is the obvious next increment if voting turns out to
matter.

## 6. Measurement, and the honest warning

**This cannot be validated on the current playtest decks.** Three
political cards across three decks, all in one seat
(`ai-decision-profile-2026-09-18.md`). A bench run on that table will
report a dead heat whatever this code does, and that dead heat will mean
nothing. `ai-politics-bench-design.md` is a hard prerequisite, not a
nice-to-have.

Expect the honest outcome to be modest even then. §5–§8 of
`richer-options-design.md` is four consecutive measured disappointments,
and the discipline that produced them applies here: **the defect is
certain, the gain is not.**

## 7. Open questions for the owner

1. **Should the bot ever vote against its own referendum?** It happens at
   a real table — terms get worse than the caller expected once the
   riders land. The design says yes, when the formula says so. The
   alternative is a hard "never", which is simpler and occasionally
   wrong.

2. **Protected District's sentence, put in the question rather than
   summarised**, because the polling-votes lesson says an accounting
   question gets an accounting answer: a grant that reads **"+3 votes
   AGAINST the referendum"** may only be cast that way
   (`polling-votes-design.md` §3, and `voteGrants` is bucketed by
   direction for exactly this). So a seat can hold vote sources that
   **cannot** take the side this scorer wants. Should a directed grant it
   disagrees with be left uncast — spending nothing — or cast against a
   referendum the bot would rather pass? The economy doc answers the
   general case; this card makes it concrete and it needs your reading.
