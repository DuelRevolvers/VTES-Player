# Unlock-and-Attempt-to-Block Reactions — Design

**Status: COMPLETE — Waves 1 and 2 fully implemented (14 cards).** Owner
signed off on the recommendations: unlock = `MinionUnlocked` (persists),
forced block gated on normal eligibility except where a card says "ignoring
restrictions". Core shipped as designed — `ActionFrame.pendingAutoBlock`
converted in the settle loop via `startAutoBlock` (identical to a manual
`declareBlock`); ops `unlockAndAttemptBlock` / `unlockReactingMinion`.
Every Wave-2 rider landed too (see below).

## Why this is the next lever

The remaining unsupported reactions (~28) almost all funnel through one
mechanic: a **locked** vampire playing a reaction that unlocks it and makes
it block the current action — bypassing the normal "declare a block"
decision (which only unlocked, eligible minions get). It's the single
highest-yield reaction cluster: ~8–10 cards land directly, and the
supporting pieces (unlock, forced block attempt, "did not block" tracking)
unblock several more.

## Background: how a block works today

1. An action sits in **state A** (blocks may be declared). `blockOptions`
   offers `block:<minion>` to each **eligible** seat (prey/predator, or the
   directed target — `blockEligibleSeats`) for each minion that `canReact`
   (ready, and unlocked or awake). A **locked** vampire is never offered.
2. Choosing `block:M` sets `af.step = "B"`, emits `BlockDeclared`, and
   pushes a `blockAttempt` frame.
3. `resolveBlockAttempt` compares intercept vs stealth: success → lock the
   blocker + `pushCombat`; failure → back to state A.

Intercept reactions (Enhanced Senses) only *boost* an in-progress attempt,
and only "when needed" (stealth > intercept). The cards in this doc are
different: the reacting vampire is **locked**, so there is no attempt to
boost — the card must both unlock it and start the attempt.

## Core mechanic

A new op, invoked from a reaction's resolution:

```
ops.unlockAndAttemptBlock(minion, {
  interceptBonus?: number,     // "…with +N intercept" (Second Tradition)
  ignoreRestrictions?: boolean, // Eagle's Sight: ignore prey/predator/target
  bloodCost?: number,          // "burns 1 blood to unlock" (Second Tradition)
})
```

It emits `MinionUnlocked` (and burns `bloodCost` if any), then records a
**pending auto-block** on the action frame:

```
ActionFrame.pendingAutoBlock?: { minion; interceptBonus; }
```

The reaction resolves inside a card-play frame *on top of* the action, so
we cannot push the block attempt there (it would nest under the card). Two
options — I recommend **(a)**:

- **(a) Deferred conversion (recommended).** When the reaction's card-play
  frame pops and control returns to the action, the engine sees
  `pendingAutoBlock` and converts it into a block attempt exactly as
  `declareBlock` does (emit `BlockDeclared`, push `blockAttempt`, set
  `af.step = "B"`), applying `interceptBonus` as an `InterceptModified` for
  that minion first. This reuses the entire existing block-attempt
  resolution path (intercept-vs-stealth, success→combat, fail→state A) with
  zero duplication.
- (b) Push the attempt directly from the op. Rejected — it nests the block
  frame under the resolving card frame and tangles the impulse order.

### Offering the option (usability)

The reaction is offered in the action's block window to a **locked** ready
vampire via the per-mode locked-candidate machinery already built for Eyes
of Argus. Additional gates, as data on the spec/mode:

- `af.step === "A"` and no block attempt in progress (you can only start a
  block while blocks may still be declared).
- The reacting seat is **block-eligible** (`blockEligibleSeats`) — *unless*
  the mode sets `ignoreRestrictions` (Eagle's Sight).
- "when needed" does **not** apply (these create the attempt), matching the
  cards' "even if intercept is not yet needed" wording.

## Primitive shape (proposed)

```
| { kind: "unlockAndAttemptBlock";
    interceptBonus?: number;
    ignoreRestrictions?: boolean;
    bloodCost?: number }
```

Reduce-bleed / intercept-boost superior modes reuse existing primitives
(`modifyBleed` negative, `modifyIntercept`). The maneuver/press-if-blocks
riders reuse the **blocker-combat-rider** built last run
(`blockerCombatRider`).

## Related sub-mechanics (same cluster)

1. **"Unlock this vampire"** (Guard Dogs, Rat's Warning) — a locked vampire
   during a bleed against you simply *unlocks* (no forced block); the
   controller then blocks through the normal flow (the vampire now
   `canReact`). Op `ops.unlockReactingMinion(minion)` = emit
   `MinionUnlocked`. Superior riders (maneuver/press if it blocks) reuse
   `blockerCombatRider`. Simpler than the core mechanic; recommend bundling.
2. **"Unlock after it blocked"** (Cats' Guidance, Forced Vigilance basic) —
   "usable by a locked vampire who has blocked, after block resolution:
   unlock this vampire." Needs a new **post-block-resolution** window /
   timing gate. Recommend **deferring** (distinct timing).
3. **"Did not block" penalty** (Dogged Pursuit, Eyes of the Wild) — "if this
   vampire does not block this action, lock / attach after action
   resolution." Needs to record that the vampire was offered-and-declined
   and settle a penalty at action resolution. Recommend **deferring**.

## Proposed card scope

**Wave 1 (this mechanic + existing primitives) — recommend landing:**

| Card | Notes |
|---|---|
| Sense the Savage Way (101717) | requires cap 7+; basic +1 intercept, sup unlock+block |
| Sentry Signal (102339) | basic unlock+block, sup reduce bleed 3 |
| Second Tradition: Domain (101706) | requires prince/justicar; basic +2 intercept, sup burn 1 + unlock+block +2 |
| Eagle's Sight (100598) | basic +1 intercept, sup attempt-to-block ignoring restrictions |
| Guard Dogs (100863) | "unlock this vampire" + maneuver-if-blocks (sub-mechanic 1) |
| Rat's Warning (101547) | "unlock this vampire" + press-if-blocks (sub-mechanic 1) |

**Wave 2 — partially shipped.** Landed: **One With the Land**
(no-strike-first-round, via a `blockerCombatRider.noStrikeFirstRound` flag +
`CombatFrame.suppressStrikesRound`); **My Enemy's Enemy** (redirect to
predator's predator, via `redirectBleed.toPredatorsPredator` + a
`predatorBleedingYou` usability); **Dogged Pursuit** (the did-not-block
penalty — `ActionFrame.blockPenalties`, settled in `resolveAction` for any
forced-block minion that is not the successful blocker: basic locks it,
superior self-attaches the card, whose bespoke overlay grants a later
"burn for +1 intercept"). Still deferred — each needs its own subsystem:

**Cats' Guidance / Forced Vigilance shipped** — post-block-resolution
timing was resolved as: the "after block resolution" window is the **first
window of the combat a successful block produced** (`CombatFrame.fromBlock`
flag + `afterBlockResolution` usability), where the blocker's controller
unlocks the opposing (blocker) combatant. Forced Vigilance's superior
("unlock during a directed action") reuses `unlockMinion` +
`actionDirectedAtYou`.

**Eyes of the Wild shipped** — the did-not-block lock plus a repeatable
"burn 1 blood for +1 intercept during this action", modeled as an
action-scoped grant (`ActionFrame.interceptBurnGrants`) offered as a
built-in `burnForIntercept` option in the block attempt.

**Organized Resistance shipped** — a bespoke handler: a locked baron's
reaction targeting a *different* Anarch you control (give the blocking
Anarch +1 intercept, or unlock a locked Anarch to force-block with +1).

**Melange shipped** — the hardest card in the cluster. On a successful
block it attaches (a new `ActionFrame.attachOnBlock` processed in
`resolveBlockAttempt`); to keep "you still control this card" working
against the engine's bearer-owns-attachment assumption, it is modeled as a
**seat-level permanent of the blocker, tagged `melangeOn:<actor>`**. Its
bespoke overlay then offers "burn for +1 bleed" during a bleed against the
tagged minion's controller. Deviation: not auto-burned if that minion
leaves play (owner-flagged).

**Wave 2 is 8/8 — the whole unlock-and-block cluster is done.**

## Open questions for you

1. **Unlock vs wake.** These cards say "unlock" (persists) rather than
   "wake" (this action only). I plan to emit `MinionUnlocked` (persists), so
   a vampire unlocked this way stays unlocked into your next turn. Agree?
2. **Wave 1 scope.** OK to land the six Wave-1 cards and defer the riders,
   or do you want a specific card pulled forward/back?
3. **Eligibility default.** I'll gate the forced block on normal
   block-eligibility except where a card says "ignoring restrictions."
   (Alternative: allow any reacting seat — but that contradicts p. 25.)

## Deviations anticipated

- Contested/again-block nuances (a seat that already declined) are handled
  by the normal state-A flow; no special-casing.
- The "did not block" penalty and post-block-unlock timing are explicitly
  Wave 2, so a few cards stay unsupported until then.
