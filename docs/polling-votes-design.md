# Votes Granted by Cards During Polling — Design

Status: **IMPLEMENTED** (2026-07-19; owner sign-off: per-seat vote
accounting; full 8-card wave; Protected District against-votes as a
flexible grant). Implementation notes: `ReferendumFrame` gained
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

Protected District's "+3 votes **against**" is modeled as a flexible
grant (the primogen's controller casts them against, as they would
anyway) — §7 Q3.

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
