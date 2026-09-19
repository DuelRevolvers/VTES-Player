# Votes Granted by Cards During Polling — Design

Status: **IMPLEMENTED** (2026-07-19; owner sign-off: per-seat vote
accounting; full 8-card wave; Protected District against-votes as a
flexible grant — **reversed 2026-09-18, see §9**). Implementation notes: `ReferendumFrame` gained
`callingMinion` + `voteGrants`; `PlayContext` gained `referendum`; the
polling decision now also offers `handlerOptions`/`abilityOptions` in the
`referendum.polling` window (a play rewinds the polling impulse like a
vote does); `modifyVotes` is a polling-window effect gated by
caller/reactor + the playing vampire's discipline; `cardType:
"modifierOrReaction"` routes dual-use cards to either path; `lockGrant`
gained a `"votes"` grant (+ `perPoolX` for Oxford). En route, a general
`{ all: [...] }` discipline requirement was added (Iron Glare's
"[pot][pre]"), reusable for future dual-discipline cards (Hunter's
Mark).

The largest remaining single unlock: cards that grant votes during a
referendum's polling step ("This vampire gets +2 votes", "lock this
location to get +3 votes"). The politics gate built the referendum and
polling machinery; this gate lets **cards be played during polling** and
adds a `modifyVotes` effect + location vote-grants, unlocking a wave of
**8 cards**.

---

## 1. Rulebook facts (verified, p. 28)

- During the polling step, "Action modifiers, reaction cards, cards in
  play, etc. that grant more votes or ballots can all be used subject to
  the normal rules of playing cards."
- **Who may play what** (same as any action): "Only the acting minion can
  play action modifiers, and only ready unlocked minions controlled by
  Methuselahs **other than** the acting minion's controller can play
  reaction cards." The "acting minion" here is the vampire that called the
  political action.
- Votes are cast for or against, freely, in any order; a cast vote can't
  be changed; tally on quiescence, ties fail (already implemented).

## 2. Kernel: playing cards during polling

The `referendum.polling` window already exists but only offers votes +
pass. Two changes:

- **`ReferendumFrame.callingMinion: MinionId`** — the vampire that called
  the political action (needed to know who the "acting minion" is for the
  action-modifier / reaction split). Set when the political action's
  referendum is pushed. Blood-hunt referendums have no calling minion
  (their `callingMinion` is unused — reaction vote cards may still be
  played by anyone, per "any referendum").
- **`PlayContext.referendum: ReferendumFrame | null`** — so a card's
  `options()` can see the caller and the calling minion. Built in the
  polling decision.
- The polling decision additionally offers `handlerOptions(seat,
  "referendum.polling")` and `abilityOptions(seat, "referendum.polling")`.
  Playing a card rewinds the polling impulse cycle (an effect was used,
  p. 8) — exactly like casting a vote already does.

## 3. Kernel: vote accounting

> **Superseded in part by §9 (2026-09-18).** The record below is now
> bucketed by direction. Everything else in this section still holds.

```ts
// ReferendumFrame gains:
voteGrants: Record<SeatId, number>;   // bonus votes from played cards
```

A resolved vote card calls `ops.grantVotes(seat, amount)` →
`voteGrants[seat] += amount`. `pollingOptions` then offers a **granted
votes** source (`vote:grant:for|against`) when `voteGrants[seat] > 0`,
cast like any other source and consumed (added to `usedSources` as
`grant:<seat>`). This pools grants **per seat** rather than per vampire —
a simplification with no effect on the tally (which only sums for vs.
against), noted §7 Q1.

`EngineOps.grantVotes(seat, amount)` is the single new op.

## 4. Spec vocabulary

```ts
| { kind: "modifyVotes"; amount: number }        // "gets +N votes"
```

Compiled in `compileModifierOrReaction`: a mode with `modifyVotes` is
offered in the `referendum.polling` window (instead of `action.effects`),
gated by card type:
- **Action modifier** → only the caller seat, and the calling vampire
  must satisfy the mode's discipline (it is the "acting minion").
- **Reaction** → non-caller seats' ready unlocked minions with the
  discipline.
- **Action modifier/reaction** (dual type — Ominous Chorus, Absolute
  Tyranny) → either path. Modeled with a new `cardType:
  "modifierOrReaction"` (or a `dualUse` flag) routing to whichever path
  the seat qualifies for.

`requiresSect` / `requiresClan` / `requiresTitle` already gate the
playing vampire (Party Out Of Bounds needs Anarch; Ominous Chorus a
Lasombra; Protected District a primogen).

**Location vote-grants**: the `lockGrant` shape (clan/sect gate) gains a
`"votes"` grant usable in `referendum.polling` — lock the location, call
`grantVotes`. A `perPoolX` flag covers Oxford University ("lock and burn X
pool → +2X votes"), enumerating X like Lightning Reflexes' per-blood-X.

## 5. The wave (8 cards)

**Action modifiers / reactions (`modifyVotes`):**
| Card | Modes |
| --- | --- |
| **Bewitching Oration** (pre, AM) | +2 / +4 votes |
| **Iron Glare** (pot/pre, AM) | +2 votes (polling) / +2 bleed (bleed) |
| **Old Friends** (obf, AM) | +1 bleed (bleed) / +2 votes (polling); delayed replace |
| **Ominous Chorus** (—, AM+Reaction) | Lasombra +3 votes |
| **Party Out Of Bounds** (Anarch, Reaction) | reduce-bleed 2 / +2 votes / +1 intercept |
| **Protected District** (primogen, Reaction) | reduce-bleed 3 / +3 votes |

**Location vote-grants (`lockGrant: "votes"`):**
| Card | Grant |
| --- | --- |
| **Ventrue Headquarters** | lock → +3 votes |
| **Oxford University, England** | lock + burn X pool → +2X votes |

~~Protected District's "+3 votes **against**" is modeled as a flexible
grant (the primogen's controller casts them against, as they would
anyway) — §7 Q3.~~ **Reversed 2026-09-18 (§9): they would not "anyway", and
a real game showed a seat casting them for the referendum they were played
to stop.** The grant is direction-locked.

## 6. Deferred (out of this gate)

- **Perfect Paragon** ([PRE] "-1 intercept to allies/younger vampires" —
  a global block debuff, unmodeled).
- **Absolute Tyranny** ([POT][PRE] Path of Power clause — Paths out of
  scope; its basic vote mode ships only when Paths do).
- **Malkavian/Toreador Justicar** — referendums that *put a title on* a
  vampire (a title-granting referendum effect; own follow-up).
- **Elysium / Power Structure / New Carthage** — all three DONE (Power
  Structure in the politics follow-ups; **Elysium and New Carthage in
  `docs/politics-locations-design.md`**, which is also where the
  per-minion vote counting this entry was waiting for turned out to
  already exist).
- **The Black Throne** (contract clause) DONE; **Powerbase: Madrid** DONE;
  **Ferraille** DONE (`docs/politics-locations-design.md` §3 — a fixed
  `lockGrant.poolCost` plus `oncePerTurn`, not Oxford's `perPoolX`).
- **Ballots** (Sabbat) — not in this wave.

## 7. Open questions for the owner

1. **Vote accounting** — pool granted votes **per seat** (recommended,
   simplest, tally-identical) or track per vampire?
2. **Wave** — the 8 above, or start with the pure `modifyVotes` action
   modifiers (Bewitching Oration, Iron Glare, Old Friends) + Ventrue
   Headquarters and add the multi-mode/dual/location-X ones after?
3. **Protected District** — flexible granted votes (recommended) or a
   direction-locked "against" grant?

## 8. Tests (once approved)

Kernel: an action-modifier vote card is offered only to the caller during
polling; a reaction vote card only to non-callers; granted votes become a
castable source and swing the tally; a location lock-for-votes works and
locks. Cards: one scenario per wave card, negative space asserted (Iron
Glare's vote mode not offered outside polling; Ominous Chorus playable by
both caller and reactor; Oxford's X enumerated by pool). Fuzz: add the
wave; referendums still terminate (grants are bounded per card, each
card/location played at most once per its limits).

---

## 9. Reversal: Protected District's grant is direction-locked (2026-09-18)

**§7 Q3 was answered "flexible" and that answer was wrong.** A real game
(`logs/vtes-game-2026-09-18T04-53-41-025Z.json`, seq 1069–1078) shows what
it costs: Bad Guy played Protected District — *"this vampire gains +3
votes **against** the referendum"* — to stop Alice's Consanguineous Boon,
and then cast the resulting grant **for** it. The card was played as a
defence and spent as a vote in favour of the thing it was defending
against. Nothing on the table showed it happening, which is exactly the
shape of bug "no partial cards" exists to prevent.

### Why the original answer looked safe

Q3 was asked as a question about *accounting* — per seat or per vampire,
and does the tally come out the same. It does. But the direction is not an
accounting detail, it is the card's text, and it is the **only** one of
the ten `modifyVotes` cards that prints one:

| Card | Printed | Direction |
|---|---|---|
| Bewitching Oration, Iron Glare, Old Friends, Ominous Chorus, Perfect Paragon, Absolute Tyranny, Surprise Influence, Party Out Of Bounds | "this vampire gets +N votes" | none — the seat aims them |
| Elysium / Ventrue HQ / Oxford / Ferraille | "+N votes" | none |
| **Protected District** | "+3 votes **against** the referendum" | **against** |

So "flexible" was right for nine cards and wrong for one, and the one is
the only one anybody would notice — because it is the only one whose whole
purpose is the direction.

### The shape

`voteGrants` is now bucketed, in **one** record rather than a flexible one
plus a directed sibling, because two records holding the same question is
how they drift:

```ts
export interface VoteGrants { any: number; for: number; against: number }
voteGrants: Record<SeatId, VoteGrants>;
```

- `ops.grantVotes(seat, amount, direction = "any")` — the default keeps all
  seven existing callers unchanged, so the nine direction-less cards say
  nothing and get the old behaviour.
- `spec.modifyVotes` gains an optional `direction: "for" | "against"`.
  Protected District sets `"against"`; nothing else sets it.
- **Each bucket is its own vote source, spent separately**:
  `vote:grant:*`, `vote:grantFor:for`, `vote:grantAgainst:against`, with
  `usedSources` keys to match. A seat holding both a flexible grant and a
  directed one can cast both — spending one must not silently spend the
  other.
- A directed grant is offered by `oneWay`, a sibling of `both` that emits
  the single legal option. Like the untolled branch of `both` it takes no
  `voter`, so no against-toll applies — a card-granted vote is untolled by
  construction.

### The lesson

**A parameter named for the ACCOUNTING will be decided on accounting
grounds.** Q3 asked "per seat or per vampire?" and got a tally-identical
answer; the word "against" in the card text never entered the question, so
the design review could not catch it. When an open question is about how
to *store* something a card prints, put the card's sentence in the
question — otherwise the reviewer is answering a different one.

And: **"the tally comes out the same" is a claim about totals, not about
legal options.** The fuzz cannot see a too-permissive option list (CLAUDE.md,
"Tests that lie"), and the tally was never wrong — only the set of things a
seat was allowed to do. Negative-space assertions are the only instrument
that reads this, which is why the test pins the *absent* `vote:grant:for`
and `vote:grantAgainst:for` before it pins the outcome.

### Tests

`tests/cards/polling-votes.test.ts`, "Protected District (102214) — a grant
the CARD aims": the `for` half of the source is never offered and no
flexible bucket exists to launder it through, asserted on the option list
before any vote is cast; and the primogen's own title vote still casts
afterwards, so the two sources are spent independently. Both fail against
the pre-2026-09-18 code, which offered `vote:grant:for`.
