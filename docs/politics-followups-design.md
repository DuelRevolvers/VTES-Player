# Politics Follow-ups — Gate 5 (IMPLEMENTED)

Status: APPROVED — implementing (doc-per-gate; owner makes the scope calls).

Two related political mechanics on top of the referendum machine
(docs/politics-design.md).

## Title-granting referendums

Cards whose successful referendum "puts this card on the chosen vampire to
represent the title of X". The card is **held aside** at action resolution
(not burned) and resolves with the referendum:

- Handler flag `isTitleGrant`: `resolveAction` sets `entered = true` for
  these so the card is not burned when the action succeeds; the
  `ReferendumFrame` now carries `cardInstanceId`.
- On a **pass**, `applyReferendum` emits `PermanentEnteredPlay` (attached to
  the chosen vampire) + a new `TitleGranted` event that sets
  `MinionState.title`. On a **fail** (or no valid target), the held card is
  burned in `resolveReferendum`.
- Target choice is the referendum's terms step (`referendumTerms`).
- In-referendum clan vote riders ("each Malkavian gets +1 vote") are seeded
  by a new `referendumSetup(frame, state)` hook that adds per-seat
  `voteGrants` = the count of that seat's ready vampires of the clan, cast
  through the existing granted-votes source.
- `VampireTitle`/`TITLE_VOTES` gain **cardinal** (3 votes, Sabbat).

Cards: **Malkavian Justicar** (101154, justicar, ready Camarilla Malkavian,
+1 vote each Malkavian), **Toreador Justicar** (101990, justicar, ready
Toreador, +1 vote each ready Toreador), **Cardinal Benediction** (100294,
cardinal, Sabbat vampire cap 7+; requires a Sabbat vampire to call).

## Per-clan vote statics

`permanent.lockGrant` gains `perClanMinion`: locking grants
`amount ×` (the owner's ready vampires of the clan/sect), rather than a flat
amount. Card: **Power Structure** (101430, unique master; "lock during
polling to give each Lasombra you control +1 vote").

## Deviations / notes

- Cardinal Benediction's "non-Sabbat vampires cannot cast votes or ballots
  during this referendum" rider is unmodeled (a polling-source restriction);
  the title grant and Sabbat-target choice are faithful. Revisit with the
  ballots gate.
- New Carthage (global "titled Brujah get +1 vote, Ventrue −1") — **DONE
  2026-09-01**, `docs/politics-locations-design.md` §2. The deferral said
  it needed "a global-tally hook not yet present", which was true when
  granted votes were pooled per seat; `pollingOptions` has counted
  per MINION since Saulot's Guiding Wisdom, so the card is one
  `auraBonus(state, m, "votes")` term added to that sum, clamped at zero.
  **A deferral is a claim about the code as it was.**
- A justicar/cardinal placed on a vampire that already holds a title simply
  overwrites `title` — the "one title per vampire" contest is not modeled
  (consistent with the existing own-duplicate-only stance).
