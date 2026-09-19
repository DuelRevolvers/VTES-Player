# Vote economy — spending votes that cannot change the result (2026-09-18)

**Status: designed, not built. Owner review before kernel code.**

Depends on `ai-referendum-view-design.md` and
`ai-vote-scoring-design.md`. Deliberately separate from the latter so the
two can be measured apart.

## 1. The question this answers

`ai-vote-scoring-design.md` answers **which way** to vote. It does not
answer **whether to vote at all**, and in VTES those are different
questions with different costs:

- A vote source **spends once**. `ReferendumFrame.usedSources` records it,
  and "a source spends its votes once, at a count read when it casts"
  (`referendum-blood-design.md` §1).
- Some casts cost **blood**. Alexander Silverson's per-cast toll is on the
  option as `toll`/`tollFrom`; Cheval de Bataille taxes every vampire that
  voted against, swept at the tally (`againstBloodTaxAtTally`); Mob Rule
  and Rant! sell votes for blood outright (`bloodVoteOffers`).
- Some casts cost **pool or cards** through the referendum's riders.

The current policy prices none of it. `o.toll` is on the option and the
scorer never reads it — it reads `o.count` and `o.inFavor` and nothing
else. So a bot will burn blood to add votes to a referendum that was
going to pass anyway, and burn blood voting against one it cannot stop.

## 2. WHY THIS IS ARITHMETIC AND NOT A GUESS

This is the unusual part, and it is what makes the item worth building.

**Every vote source at a VTES table is public.** Titles are printed on
face-up vampires (p. 28). The Edge is public. Vote-granting cards in play
are face up. `voteGrants` came from cards played face up during polling.
`usedSources` is what the table has watched being spent.

So "can my votes still change this outcome" is **computable from open
information**, not estimated. Define, at the moment of my decision:

```
for      = view.referendum.votesFor
against  = view.referendum.votesAgainst
unspent  = Σ votes of every source on the table not in usedSources,
           split into those that can only vote for, only against,
           and either
```

A referendum passes on **more for than against; a tie fails** (p. 28, and
the frame comment says so). From that:

- **`decided-pass`** — even if every unspent vote that could oppose does,
  `for` still exceeds `against`.
- **`decided-fail`** — even if every unspent vote that could support does,
  it does not.
- **`live`** — anything else.

**In the first two states my vote cannot change the result**, and any
cost attached to casting it is pure loss.

## 3. The design

Three rules, in order of confidence:

**(a) Never pay a cost into a decided referendum.** If the state is
`decided-pass` or `decided-fail` and the option carries a `toll`, a blood
purchase, or a tally tax, score it below `pass`. This is the rule with no
downside: the money buys nothing that exists.

**(b) Prefer to keep an untolled source unspent when the referendum is
decided AGAINST my interest and I cannot flip it.** Weaker, because
casting a free vote costs nothing *this* referendum — but `usedSources`
is per referendum, so there is genuinely nothing saved. Recommended to
**leave this one out of v1** and let free votes cast freely; it is the
kind of rule that reads as wisdom and measures as noise.

**(c) Buy votes only when they flip the result.** `bloodVoteOffers` is an
open, repeatable offer (Mob Rule, Rant!). A policy that treats each
purchase as "free value" — which is exactly how the current file treats
`useManeuver`, `preventCredit` and friends, at a flat `w.playCard` — will
drain its own vampires. Price a purchase at: what the result is worth to
me (the §3 formula of the vote doc), **times whether this purchase moves
the state out of `decided-*`**, minus the blood.

## 4. The trap this walks into, named in advance

**A referendum is not decided until polling closes**, and the tally is
taken at quiescence. Other seats can still play vote-granting cards —
Bewitching Oration, Protected District — *after* my decision. So
`decided-pass` computed from the table right now can be wrong a moment
later.

That is not a reason to skip it; it is a reason to be conservative:

- Count unspent sources **generously** (assume every source that could
  oppose me will), so `decided` means decided under the worst case.
- **Cards not yet played cannot be counted** — they are in hands, which
  the boundary hides, and guessing them is determinization
  (`ai-v2-design.md` §6). The rule therefore has a known false-positive
  mode and must only gate *costs*, never the direction of the vote.

This is why (a) is recommended and (b) is not: (a) fails safe — the worst
case is that the bot declines to pay for a vote it turns out it wanted.

## 5. Tests

- **`decided-pass` with a toll:** a referendum already unopposable, an
  Alexander Silverson toll on the cast; assert the bot does NOT pay.
  Assert the same bot DOES pay when one more unspent opposing source
  exists — same card, same seat, one fact different.
- **Tie fails (p. 28):** votes at 3–3 with one unspent source. Assert the
  state reads `live`, not `decided-pass`. The tie rule is the single most
  likely place for an off-by-one, and the assertion must name p. 28.
- **`bloodVoteOffers`:** a vampire at 2 blood, an offer that would not
  flip the result; assert no purchase. Then a position where one purchase
  does flip it; assert the purchase. **Both halves**, because a test where
  every case declines has tested the fixture.
- **Directed grants:** a `voteGrants` bucket that may only be cast
  against (Protected District) is counted in `unspent` on the **against**
  side only. Getting this backwards is silent — see `polling-votes-design.md` §3.
- **Negative space:** with no referendum on the stack, none of this code
  is reachable, and `view.referendum` being `undefined` must not throw in
  any scorer that consults it.

## 5.1 BUILT, 2026-09-18 (platform 0.10.71)

Rule **(a)** shipped, rule **(c)** shipped as a price rather than a
special case, and rule **(b)** was left out as the doc recommended.

- **`VtesEngine.referendumDecided`** — "more for than against passes,
  ties fail" (p. 28) against everything still castable, computed by
  walking each standing seat's own `pollingOptions` so there is ONE
  enumeration of what a vote source is. A flexible source counts on both
  sides; a directed one counts only on its own.
- **`castVote.decided`** — stamped onto every vote in the decision,
  derived on each read rather than stored on the frame, because a
  referendum stops being decided the moment somebody grants votes.
- **`voteTollCost`** — the policy now reads `o.toll`, which it did not
  read anywhere before. A toll is subtracted in a live referendum and
  refuses the cast entirely in a decided one.

### It fires, and it is worth having

| table | polling decisions | already decided |
| --- | --- | --- |
| default | 70 | **20** (19 pass, 1 fail) |
| politics | 134 | **21** (16 pass, 5 fail) |

Roughly one polling decision in five is already settled, so a bot that
pays into them is paying often.

**Re-measured 2026-09-19 (0.10.77)**, 20 games each: default **19 of
69**, politics **31 of 131**. The "roughly one in five" holds — 28% and
24% — so the rule is worth having on both tables.

### THE HONEST LIMIT: the cost half was INERT on these decks — FIXED 2026-09-19

**No tolled vote appeared in 40 games.** Neither Alexander Silverson (the
per-cast toll) nor Mob Rule / Rant! (votes bought with blood) is in the
playtest or politics decks, so the rule that refuses to pay is correct,
tested, and currently unreachable in a real game here.

That is the `ai-combat-range-design.md` §5 situation arriving for this
item: shipped on trace tests, with the measurement deferred until a deck
contains the cards. Adding a toll card to the politics table is the
follow-up, and it belongs with `ai-politics-bench-design.md` §3.

**DONE, 2026-09-19.** Three copies of Alexander Silverson went into the
politics table's caller crypt, and the rule now fires: **22 tolled vote
decisions in 40 games**, up from 0 (`ai-politics-bench-design.md` §7.3).
The cost half is no longer inert.

### Two fixture mistakes worth recording, both mine

The tie-rule test asserted "nothing left to cast" and got `null` three
times. Twice, and both times the FIXTURE was wrong rather than the code:

1. **p. 28 lets a Methuselah vote with a political action card from
   hand**, so full hands alone keep every position live.
2. **The CALLER keeps their calling card's own vote** until they spend
   it — so a 3–3 tie is genuinely still live, because the caller can
   break it. Calling that settled would have the bot decline to pay for
   the vote that decides the referendum.

Both are now assertions rather than assumptions, including a positive
control that the same tie reads `live` while the caller's vote is
unspent. **"A guard clause in a test is a silent skip", and a fixture a
test needs, the test builds.**

## 6. Open question for the owner

**Cheval de Bataille taxes at the TALLY, not at the cast** — "any vampire
casting votes or ballots AGAINST this referendum burns N blood when the
results are tallied", and the frame notes it "reaches votes cast BEFORE
the card was played [RTR 19951110]".

So a bot can vote against for free and be taxed afterwards by a card
played later. Should the economy rule attempt to anticipate that — which
means reasoning about a card that is not on the table, i.e. guessing a
hand — or accept it as a cost it cannot see? The design assumes the
latter, on the boundary ruling of 2026-09-06. Confirming that is your
call, because it is the difference between "the bot got taxed" being a
bug report and being correct play.
