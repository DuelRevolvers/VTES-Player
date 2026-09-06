# Ballots — Gate 6 (IMPLEMENTED)

Status: APPROVED — implementing (doc-per-gate; owner makes the scope calls).

## What "ballots" actually needs

The V5 "ballot" cards in the pool don't need a separate ballot *source*
parallel to votes — the vote machinery already tallies whatever a titled
vampire casts. What they need is a **referendum-scoped restriction on which
vampires may cast** (by sect): "non-Camarilla/non-Sabbat vampires cannot
cast votes or ballots this referendum." That single mechanic covers Closed
Session, Private Audience, and completes Cardinal Benediction's rider.

## Mechanic

- `ReferendumFrame.voteRestriction?: { sect }`. `pollingOptions` skips a
  titled vampire's vote source when its `sect` differs from the restriction.
  Methuselah-level sources (Edge, calling card, granted votes) are
  unaffected — they are not vampires casting.
- Op `restrictReferendumVotes(sect)` sets it.
- Primitive `restrictVotes { sect }`, a **caller-only** polling-step action
  modifier, playable once and only before any vote is cast.
- Spec field `requiresControlledTitle`: "Requires a prince/justicar/…" on
  these modifiers means the *controller* must hold a ready vampire with one
  of those titles (not the calling vampire specifically).
- `VampireTitle`/`TITLE_VOTES` gain the Sabbat titles bishop (1),
  archbishop (2), priscus (1), regent (4) — cardinal (3) was added in
  Gate 5 — so Private Audience's requirement and Sabbat vote values work.

## Cards shipped

- **Closed Session** (100364): non-Camarilla cannot cast; requires a
  prince/justicar/Inner Circle member.
- **Private Audience** (101490): non-Sabbat cannot cast; requires an
  archbishop/priscus/cardinal/regent.
- **Cardinal Benediction** (100294) now applies its "non-Sabbat cannot cast"
  rider through the same field (via `referendumSetup`), closing the Gate 5
  deviation.

## Deferred (need other mechanics)

- Scalpel Tongue, Telepathic Vote Counting (force a vampire to abstain /
  cancel already-cast votes), Scorn of Adonis (post-tally pool burn for
  against-voters), Expulsion (multi-turn "cannot vote/block/react"), Yoruba
  Shrine (target-in-terms cancel) — each is a distinct effect beyond the
  sect restriction; they belong to the one-off phase or a counters/latch
  mechanic.
