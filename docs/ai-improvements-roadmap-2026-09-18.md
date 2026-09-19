# AI improvements — the set, and the order (2026-09-18)

**Status: all designed, none built. Owner review before kernel code.**

Eleven design docs were written in one pass on 2026-09-18, one per
proposed change. This is the index, the dependency order, and the honest
expectation for each. **It is not a plan of record until the owner signs
off on the docs it points at.**

## The measurement everything cites

`ai-decision-profile-2026-09-18.md` — 20 games, 13352 decisions, 2908
real choices, the option-kind profile, and the two numbers that started
all of this: **votes cast FOR 70, AGAINST 0**, and **70 of 70 vote
decisions offered both directions**.

## The docs

| # | doc | what it changes | evidence behind it |
| --- | --- | --- | --- |
| 0 | `ai-politics-bench-design.md` — **BUILT 2026-09-18 (0.10.66)** | a table where politics happens | 3 political cards across 3 playtest decks, all in one seat |
| 1 | `ai-referendum-view-design.md` — **BUILT 2026-09-18 (0.10.67)** | `view.referendum` projection + declared polarity | the referendum frame is the only one `viewFor` drops |
| 2 | `ai-seat-relationships-design.md` — **BUILT 2026-09-18 (0.10.68)** | one prey/predator/cross helper | `predatorOf` does not exist in the policy |
| 3 | `ai-vote-scoring-design.md` — **BUILT 2026-09-18 (0.10.69)** | how a bot votes | 70/0, measured |
| 4 | `ai-referendum-terms-design.md` — **BUILT 2026-09-18 (0.10.70)** | how a bot aims its own referendum | terms answered in offered order |
| 5 | `ai-vote-economy-design.md` — **BUILT 2026-09-18 (0.10.71)** | whether to spend a vote at all | `o.toll` is on the option and never read |
| 6 | `ai-combat-range-design.md` — **BUILT 2026-09-18 (0.10.72)** | strikes, maneuvers, press | neither agent has ever read `.range` |
| 7 | `ai-block-action-value-design.md` — **BUILT 2026-09-18 (0.10.73)** | what an action is worth blocking | every action card shares one weight |
| 8 | `ai-answer-choice-design.md` — **BUILT 2026-09-19 (0.10.74)** | which answer to a choice frame | answered in offered order, 1.7% of choices |
| 9 | `ai-vote-search-horizon-design.md` — **BUILT 2026-09-19 (0.10.75)** | `SearchAgent` at a referendum | one ply evaluates before the tally |
| 10 | `ai-ash-heap-reading-design.md` — **MEASURED AND DECLINED 2026-09-19** | reading public ash heaps | the richest public zone, read by nobody |
| — | `ai-playstyles-design.md` — **BUILT 2026-09-19 (0.10.76)** | Balanced / Bruiser / Turtle / Politician | owner request, 2026-09-18 |

## Dependency order

```
0  bench decks ──────────────┐   (nothing can be MEASURED before this)
1  view.referendum ──┬─ 3 vote scoring ─┬─ 5 vote economy
                     │                  └─ 9 search horizon
2  seat relations ───┼─ 4 terms
                     └─ 7 block value (optional layer c)
6  combat range      (independent)
8  answer choice     (independent)
10 ash heap          (last, or not at all)
playstyles           (independent; but see its §11.3)
```

**0 is first and is not negotiable.** Every politics result measured
before it exists is a dead heat about a fixture.

## What to expect, stated before the fact

This project has a measured history of AI work shipping nothing —
`richer-options-design.md` §5–§8 is four consecutive disappointments, and
§8 explains structurally why. Writing the expectation down first is how
that discipline is kept.

| # | expectation |
| --- | --- |
| 3 | **Best structural case on the list.** The option list contains opposites, so a new term provably varies across it. Certain defect; uncertain strength. |
| 4 | Real, and invisible in a bench until #0 lands. The payload of every political action the bot lands. |
| 6 | A correctness fix. Likely unmeasurable on current decks; ship on trace tests and say so. |
| 1, 2 | Change nothing by themselves. Enablers, deliberately measured through their consumers. |
| 5, 7 | Plausible; #7 sits in a function with a **measured** history of indifference (two very different blocking policies gave statistically identical games). |
| 8 | Modest. The valuable half — answering at all rather than passing — is already fixed. |
| 9 | Interesting for a reason beyond strength: it is the first opponent model here that needs no hidden information. |
| 10 | Weakest — and it held up. Measured both proposed uses: the terms tie-break flips **0 of 15** ties (dead, the `blockPressure` outcome); the block term flips 6–21% (live, the `influenceUnlocks` outcome) but needs card TYPES the projection does not carry. Declined, with the numbers, in §5.1. |
| playstyles | Not a strength change at all. It is a **feel** feature, and it doubles as free A/B material for the bench. |

## The three gating decisions — ALL TAKEN (owner, 2026-09-18)

1. **Polarity: the primitive declares it.** A referendum primitive says
   whether it burns or gains, and the frame records it, so the AI can
   tell a burn from a gift. `ai-referendum-view-design.md` §5 and §7.
   Unblocks items 3, 4 and 8, and keeps a second model of the card pool
   out of the AI.
2. **Playstyle names: Balanced / Bruiser / Turtle / Politician**, fixed
   as both stored values and dropdown labels.
   `ai-playstyles-design.md` §2.
3. **A saved game remembers each bot's playstyle** — a new optional
   `botPlaystyles` beside `botSeats`, `version` unchanged.
   `ai-playstyles-design.md` §9.1.

Decision 3 as asked was about saves rather than about the opponent model
at polling, which was the third item this section originally listed.
**That one is still open** and is not a blocker for anything before item
9: `ai-vote-search-horizon-design.md` §7, a narrow and legitimate wedge
into the part `ai-v2-design.md` §6 called unsolved. It only needs an
answer when `SearchAgent` work starts.

### The per-doc open questions that remain

None of these blocks the build order; each is due when its item is built.

| doc | question |
| --- | --- |
| `ai-seat-relationships-design.md` §6 | flat cross-table, or the finer ring at 5 seats |
| `ai-vote-scoring-design.md` §7 | voting against your own referendum; Protected District's directed grants |
| `ai-referendum-terms-design.md` §7 | the `clan` key — a boon aimed at a clan nobody plays |
| `ai-vote-economy-design.md` §6 | Cheval de Bataille taxes at the tally, after the decision |
| `ai-combat-range-design.md` §7 | `reach` on the option, or a helper |
| `ai-block-action-value-design.md` §7 | whether the political-action weight is worth it |
| `ai-answer-choice-design.md` §6 | how far to take relation-scoring without polarity |
| `ai-ash-heap-reading-design.md` §7 | whether you want bots reading your discards at all |
| `ai-playstyles-design.md` §11.3 | ship Politician before the politics stack, or after |
| `ai-politics-bench-design.md` §7 | which three decks go in the politics table |
| `ai-vote-search-horizon-design.md` §7 | the opponent model at polling |

## What is NOT proposed

- **Deeper search across opponents' replies.** Needs determinization;
  still unsolved; unchanged by any of this.
- **Any relaxation of the information boundary.** Every doc here reads
  only what a person in that chair can see, and
  `tests/ai/information-boundary.test.ts` should be green and unchanged
  after all eleven.
- **A card-name table anywhere in the AI.** Named as forbidden in four of
  the docs, because it is the failure mode they would all naturally drift
  into.
