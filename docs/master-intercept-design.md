# Intercept from masters and locations — design

**Status: BUILT (wave 101, 0.11.39).** Four T1 cards:

| Card | Cost | What it does |
|---|---|---|
| Special Report | 0, out-of-turn master | a ready vampire you control unlocks and attempts to block; once this action, 1 pool buys +1 intercept |
| Warning Sirens | 0, out-of-turn master | +1 intercept to a minion targeted by a directed action, or an optional strike: dodge this round to a minion in combat |
| Club Zombie | 4 pool, unique location | lock for +1 intercept to a vampire you control; if unlocked at the start of your turn, a ready vampire you control gains 1 blood |
| Guard Duty | action, +2 stealth | attaches to the acting minion and chooses a location; when that location is the target of a directed action and you control it, burn 1 blood or burn this card to unlock and attempt to block with +1 intercept |

Out of the family: Trophy: Domain prints the same unlock-and-block, but a
trophy reaches a vampire only through the Red List award (p. 41), which is
unmodelled.

## §1 Rules read

- **p. 25–26.** A minion may attempt to block as often as its controller
  wishes, while no other minion is already blocking. Once a Methuselah
  stops attempting, "that decision is final". Intercept "can be added
  during an action only when needed, only by a blocking minion when the
  acting minion's stealth exceeds their intercept."
- **p. 9.** The out-of-turn master budget (`out-of-turn-cancels-design.md`
  §1). All three masters' plays go through `outOfTurnOpen`.
- **Rulings, shared by Special Report, Guard Duty and Trophy: Domain:**
  - It cannot be used if the vampire cannot attempt to block the action
    [LSJ 20010714-2].
  - It does not ignore the prey, predator or target restrictions
    [ANK 20180623].
  - If the unlock leaves the action without a suitable target (Ambush), the
    block attempt and its combat still happen [LSJ 20090514].
  - Special Report can be used by a vampire already attempting to block
    [ANK 20181122-2].

**One predicate, `mayAttemptBlock` (`derived.ts`).** It holds every
per-minion bar a declared block honours, with lock state aside. A block
attempt has two doors: the declared one (`blockOptions`) and the forced one
an "unlock and attempt to block" queues (`startAutoBlock`). The forced door
read only the toll, which was a live defect: Eluding the Arms of Morpheus
could push a vampire with "cannot block" into an attempt. Both doors now
call the predicate.

**Seat eligibility stays separate.** `blockEligibleSeats` answers who may
block at all; the new cards ask it through `canForceBlock` (`cards.ts`),
along with `declinedBlocks`.

## §2 Special Report

- **In state A** it names any ready vampire you control that could attempt.
  A locked vampire unlocks. An unlocked one is offered too: it simply
  attempts, and the pool grant is what it gains.
  - **Fix:** `unlockAndAttemptBlock` now unlocks only a locked minion, so
    an unlocked one fires no unlock and pays no Burden the Mind tax.
- **During a block attempt** it names only the vampire already attempting
  [ANK 20181122-2]. Its one new effect there is the pool.
- **"Once this action you may burn 1 pool"** uses `interceptBurnGrants`,
  now a record: `{ minion, currency, payer, once, source }`.
  - Eyes of the Wild's grant is blood, repeatable, paid by the blocker.
  - Special Report's is pool, used once, paid by the Methuselah who played
    it (`burn:intercept:<minion>:pool`). It is offered only when needed
    (p. 26), and never when it would oust the payer.

## §3 Club Zombie

- **The lock** is a `lockGrant` (`grant: "intercept"`). The lock grants had
  no way to say "vampire": a grant with no clan or sect matched an ally
  blocker. `vampireOnly` is new.
- **"If Club Zombie is unlocked at the start of your turn"** asks about the
  card before the unlock sweep unlocks it. So the sweep writes
  `unlockedAtTurnStart` on each of the turn seat's cards before unlocking
  anything.
- **The blood is mandatory**, so it is a choice frame raised from
  `onControllerUnlock`, not an ability. The choices are every ready vampire
  you control.

## §4 Guard Duty

- The card is a compiled action (+2 stealth, `attachSelf`).
- **"Choose a location"** is asked on success, of the acting minion's
  controller, among every location in play. The answer is stored as
  `entry.chosenCard`, the card sibling of `chosen`.
  - Another Methuselah's location is a legal choice. "And you control the
    location" is asked when the block is offered, so a location chosen
    while it was someone else's works once you hold it.
  - With no location in play, nothing is asked and the card never fires.
- **The block** is offered in state A, with no attempt pending, when:
  - the action is directed;
  - its `targetPermanent` is the chosen location;
  - you control that location;
  - the bearer may attempt (`canForceBlock`).
  - It has two prices: 1 blood (an ally pays life, which is its blood) or
    burning the card. Both open a forced block with +1 intercept.

## §5 Warning Sirens

- **"Play on a minion targeted by a directed action to give that minion +1
  intercept."** Intercept is added only when needed and only to a blocking
  minion (p. 26). So this mode is offered during the targeted minion's own
  block attempt, while its intercept falls short. Any Methuselah may play
  it, since the card names no controller; the turn seat never can (p. 9).
- **"That minion gets an optional strike: dodge this round"** is a
  round-only `grantedStrikes` entry, the same shape as the steal-blood
  grants. It is offered before range and before strikes, to either
  combatant. A second copy on the same minion in the same round is not
  offered, because it adds nothing.

## §6 Tests

`tests/cards/master-intercept.test.ts`, 14 cases. Each card has a positive
case and its negative space:
- The turn seat is never offered an out-of-turn master.
- Special Report reaches neither a barred vampire nor a seat that may not
  block.
- Warning Sirens is not offered for a blocker who is not the target, nor in
  state A.
- Club Zombie's lock skips an ally, and a card locked at the start of the
  turn gives no blood.
- Guard Duty does nothing for a stolen location or for an action aimed
  elsewhere.

The forced-block fix is pinned through Eluding the Arms of Morpheus: the
vampire unlocks, and no attempt starts.
