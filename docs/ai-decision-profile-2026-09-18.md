# The AI decision profile, re-measured (2026-09-18)

Every doc in the `ai-*-design.md` set written on this date cites the same
run. It is recorded once, here, so no doc has to repeat it and no doc can
quote a different version of it.

## How it was taken

A `HeuristicAgent` subclass that counts before delegating to `super.decide`,
run through `runBatch` over **20 games, seeds 1–20**, on
`config/playtest-decks.json` (Alice / Bob / Carol), `maxTurns` from the
config. The probe was deleted afterwards; it is three lines of counting
and is cheaper to rewrite than to maintain.

`totalDecisions = 13352`, of which **`realChoices = 2908`** — a decision
with more than one option. Every percentage below is of 2908, because a
decision with one option is not a decision the AI makes.

## The profile

| option kind | decisions offering it | share of real choices |
| --- | --- | --- |
| `pass` | 1950 | 67.1% |
| `playCard` | 1467 | 50.4% |
| `takeAction` | 654 | 22.5% |
| `endMinionPhase` | 654 | 22.5% |
| `transferToVampire` | 453 | 15.6% |
| `transferToPool` | 360 | 12.4% |
| `useAbility` | 267 | 9.2% |
| `declareBlock` | 251 | 8.6% |
| `chooseStrike` | 242 | 8.3% |
| `discard` | 238 | 8.2% |
| `useEntryAction` | 197 | 6.8% |
| `cryptDraw` | 120 | 4.1% |
| `influenceOut` | 85 | 2.9% |
| `castVote` | 70 | 2.4% |
| `answerChoice` | 49 | 1.7% |
| `usePress` | 14 | 0.5% |
| `chooseTerms` | 13 | 0.4% |
| `useManeuver` | 4 | 0.1% |
| `burnForIntercept` | 2 | 0.1% |
| `gainEdgePool` | 1 | 0.0% |

The rows sum past 100% because one decision can offer several kinds — a
minion phase offers `takeAction`, `playCard`, `pass` and `endMinionPhase`
at once.

## The two numbers the politics docs turn on

**1. The bots vote yes to everything.** Counting what the policy actually
chose, over the same 20 games:

```
votes cast:  FOR 70   AGAINST 0
votes on a referendum called by ANOTHER seat: 33, of which FOR: 33
```

**2. Every vote decision was a genuine fork.** All **70 of 70** offered
both `inFavor: true` and `inFavor: false` from the same source. That is
the precondition `richer-options-design.md` §8 says a new term must meet
to be able to change anything, and votes meet it — see
`ai-vote-scoring-design.md` §2.

> **CORRECTED 2026-09-18, the same day.** "Unconditionally" was the word
> originally written here and it was wrong. On the politics table the
> ratio is **30 of 31**: a **directed vote grant** (`grantAgainst`, the
> Protected District shape) offers one direction only, because that is
> all the card permits. The 70/70 held on THIS table because no directed
> grant ever reached play on it — the fixture was flattering the claim.
> The structural argument is unaffected for flexible sources;
> `ai-vote-scoring-design.md` §2.1 has the full correction, and
> `tests/ai/politics-table.test.ts` now pins it per source.

## THE CAVEAT THAT GOVERNS ALL OF IT

**`castVote` is 2.4% and `chooseTerms` is 0.4% because the table has
almost no politics in it, not because politics is rare in VTES.** The
three playtest decks hold **three political action cards between them,
all in Alice's**: Kine Resources Contested, Parity Shift, Malkavian
Justicar. Bob and Carol hold none.

So this profile is a measurement of the FIXTURE as much as of the game —
the project's own "empty for the wrong reason" lesson, in its deck form.
Nothing in the politics docs may be validated against this table.
`ai-politics-bench-design.md` is the prerequisite, and it is deliberately
first in the build order.

## What this profile is NOT evidence of

It says how often a decision KIND comes up. It says nothing about how
much a better answer to that kind is worth — §6 of
`richer-options-design.md` found `takeAction` at 12.6% and the gain there
was "mostly a mirage". Share of decisions is where to LOOK, never what
you will find.
