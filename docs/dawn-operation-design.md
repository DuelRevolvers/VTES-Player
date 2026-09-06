# Dawn Operation — combat-wide aggravated damage, and withdrawing a block

Status: **design + implementation** (2026-08-30). Queue item 1. Fifth wave
of the action-modifier sweep, and the card left open in
`docs/actor-riders-design.md` §8.

## 1. The card

**Dawn Operation** (100501), Action Modifier, Fortitude:

> `[for]` If this action is blocked, all damage inflicted on vampires
> during the resulting combat is aggravated. If a vampire is currently
> attempting to block, they can cancel their block attempt.
> `[FOR]` As above, but without the option to cancel their block attempt.

Note the shape: the **inferior** mode is the weaker one *because* it gives
the blocker a way out. The card is a threat — "block me and we both burn" —
and at superior level the threat cannot be answered.

It is one card, not a cluster: a pool survey found **no other V5 card** with
either "cancel their block attempt" or combat-wide aggravated damage. The
neighbouring cards (Instinctive Reaction, Precognition, Show of Force,
Night Terrors, Ensnare a Beast, Form of the Bat) are all ordinary
`blockerCombatRider`/`actorCombatRider` work and are tracked separately.

## 2. Two mechanics, and why neither fits what exists

### 2.1 "All damage … is aggravated" is not `handStrikesAggravated`

`CombatFrame.handStrikesAggravated: { acting, opposing }` is **per side**
and **per round** (reset in the new-round block), and it only reaches hand
strikes — a weapon strike ignores it. Dawn Operation is the opposite on all
three counts: **both sides**, **the whole combat**, and **every source of
damage**, weapons and environmental damage included.

So: `CombatFrame.allDamageAggravated?: boolean`, combat-scoped, set when
the rider is carried into combat.

**Where it is applied matters more than the flag.** Damage becomes
aggravated at the moment it is pushed onto `cf.pendingDamage`, and there
were **two** push sites — strike infliction and retainer output — with a
third shape (`combatRoundDamage` statics) flowing through the second. Two
sites is two chances to forget. Both now go through one
`pushPendingDamage(cf, pd)`, which is the only place the flag is read. A
future damage source cannot miss it without going out of its way.

### 2.2 It says "on vampires"

`applyResolvedDamage` already treats aggravated damage as normal for allies
and retainers (p. 32), so tagging an ally's damage would be *harmless* —
and still wrong, because the log would say aggravated and the reason would
be a coincidence rather than the rule. The flag is gated on
`victim.kind === "vampire"`, which is what the card says.

### 2.3 Cancelling is not failing

`failBlockAttempt` (the fail-block cluster) sets `BlockAttemptFrame.
forceFail`, and `resolveBlockAttempt` then adds the blocker to
`blockRestrictions.cannotBlock` — "their block attempt fails, **and they
cannot attempt to block this action again**" (Enchanting Gaze).

Dawn Operation says none of that. It says the blocker *can cancel*. The
rulebook is explicit that a withdrawn attempt is not a spent one (p. 25):

> A minion can attempt to block as many times as they wish as long as
> another minion is not already blocking. … Once a Methuselah decides not
> to make any further attempts to block, that decision is final.

Only **declining** is final. So a cancel must **not** write `cannotBlock`,
and must not lock the blocker — locking happens only on a *successful*
block (p. 25). `BlockAttemptFrame.cancelled` is therefore its own flag,
checked ahead of `forceFail` in `resolveBlockAttempt`.

This cannot loop, which was the first worry: `mayCancel` lives on the
block-attempt frame, and a re-attempt is a **new** frame with the flag
unset. The offer exists exactly once, in the attempt that was underway when
the card was played.

**Reading taken — the block toll is not refunded.** `blockCosts` is paid to
*attempt*, not to succeed (`docs/block-tax-design.md`), so a blocker who
pays 1 blood into Where the Veil Thins and then withdraws is out the blood.
Nothing in the rules refunds it, and the alternative would let a blocker
probe tolls for free.

## 3. The cancel offer is an option, not a ChoiceFrame

The obvious build is a `ChoiceFrame` — "the card stops and asks one
Methuselah a question" — and it would work. It is the wrong shape anyway.

The blocking seat is **already being asked** during a block attempt: the
frame carries an `ImpulseCycle`, and that seat cycles through
`action.effects` like everyone else. A ChoiceFrame would interrupt a
decision the seat was about to be handed regardless, and would have to be
sequenced around the block attempt's own `pop()` (the hazard recorded in
`docs/choice-frames-design.md`).

So the cancel is a plain built-in **option** in the blocking seat's
existing impulse: `cancelblock:<blocker>`, offered beside
`burn:intercept:<blocker>`, which had already established the pattern of a
built-in option scoped to `ba.blockerSeat`. No new frame, no new
sequencing, and the legal-move generator keeps its property that the whole
decision is visible in one list.

Guards on the option: the attempt must carry `mayCancel`, the seat must be
`ba.blockerSeat`, and the blocker must still be in play and be a
**vampire** — the card says "if a **vampire** is currently attempting to
block", so an ally blocker gets no way out.

Resolution reuses the existing path rather than short-circuiting it:
choosing the option only sets `cancelled`, and the attempt resolves when
the cycle goes quiescent, exactly as `forceFail` does. Others may still
respond in the same window; the withdrawal simply lands when the window
closes.

## 4. New event

`BlockAttemptCancelled { actionId, blocker }`. Reusing `BlockFailed` would
have been one line cheaper and would have narrated a deliberate withdrawal
as a failure. The log is English (`src/ui/narrate.ts`), and "Gelasia
withdraws from the block" is a different sentence from "Gelasia fails to
block".

## 5. Spec surface

`actorCombatRider` gains `combatAggravated?: boolean` — it stays on the
actor rider record even though its effect is symmetric, because it is
carried the same way: set on the action, applied when a successful block
pushes combat. A second effect, `{ kind: "offerBlockerCancel" }`, sets
`mayCancel`; it no-ops when no attempt is underway, so the card stays
playable in a modifier window with no blocker (the "if this action is
blocked" rider is still worth having).

Dawn Operation is then pure data — two modes over one card, no bespoke
handler.

## 6. Deliberate non-goals

- **The acting minion is not spared.** "All damage inflicted on vampires"
  reads both ways, and Fortitude is the soak discipline: the card is
  supposed to be survivable by the player holding it, not one-sided.
- **Out-of-combat damage is untouched.** The flag lives on the
  `CombatFrame`, so `ActionFrame.afterResolutionDamage` (Daring the Dawn)
  and any other non-combat damage stay normal. "During the resulting
  combat" is a combat-scoped clause.
