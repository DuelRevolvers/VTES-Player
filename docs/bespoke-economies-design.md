# The last three counter cards — bespoke economies and investment

Status: **design + implementation** (2026-08-29). Closes the counter-card
ledger in `docs/one-off-sweep.md`, after `docs/cost-sources-design.md` and
`docs/counter-sinks-design.md`.

## 1. Wall Street Night, Financial Newspaper (102142)

> Unique location. During an undirected action, you can lock this location
> to give a minion you control +1 intercept. A minion you control can lock
> this location to attempt to move 1 counter from an investment card to
> your pool as a +1 stealth Ⓓ action.

The first clause is the ordinary `lockGrant` intercept location plus one
new flag, `undirectedOnly`, checked against `ActionFrame.directed`.

The second clause names a card type that **does not exist in the V5
pool**: a search of all 661 cards finds "investment" mentioned by this
card and nothing else. So the clause is implemented as a granted action
whose targets are cards in play tagged `"investment"` — which correctly
enumerates *nothing* today, and starts working the day such a card is
added (phase 8, if the pool ever widens). Its test covers both: no option
with no investment card, and the full directed action against a stand-in
entry carrying the tag.

This is the honest treatment. The alternative — leaving the clause out —
would have looked identical in play today and been silently wrong later.

## 2. Carver's Meat Packing and Storage (100303)

> Unique location. After a vampire with capacity 3 or less goes to torpor,
> put 1 hostage counter on them. Vampires with any hostage counters cannot
> be moved to the ready region or be diablerized. Lock during your master
> phase to add X blood to a ready vampire you control, where X is the
> number of vampires with any hostage counters. During any unlock phase,
> any ready vampire can burn 2 blood to burn any vampire's hostage
> counters. After this card leaves play, burn all the hostage counters.

**Counters on a minion that belong to nobody.** `MinionState.corruption`
is keyed by the seat that placed it ("*your* corruption counters"), which
is wrong for hostage counters — anyone may pay to remove them. So
`MinionState.counters: Record<string, number>` holds named counters with
no owner: `"hostage"` here, `"nightmare"` for Week of Nightmares.

The restriction ("cannot be moved to the ready region or be diablerized")
is asked by the kernel at the three option sites it touches — leave
torpor, rescue, and diablerise — through `heldHostage`. The counter kind
is one card's, but the restriction it imposes is the kernel's business,
the same way `usedHuntingGroundThisTurn` lives on the minion.

Placement rides `onLeaveReady` (built for the granted-rush family), and
cleanup rides the new **`onLeavePlay`** hook, fired from `burnPermanent`
before the burn so the card can still see what it put elsewhere.

### 2.1 The ability window was single-seat

"During any unlock phase, **any** ready vampire can burn 2 blood…" could
not be expressed: `abilityOptionsFor(seat)` only ever scanned that seat's
**own** cards in play, so a card could never offer an ability to a
Methuselah who does not control it. (Granted *actions* already crossed
seats — `entryActionOptionsFor` scans everyone — but abilities did not.)

The window now scans every seat's cards, with `owner.seat` always the
card's controller, but **only for handlers that opt in** via
`CardHandler.abilityAnySeat`. Opt-in rather than opt-out because the first
attempt without it immediately broke: The Barrens enumerates from
`owner.seat`'s hand, so every Methuselah was suddenly offered "discard a
card from Alice's hand" — a crash, and a hidden-information leak besides.
An ability belongs to its controller unless the card says otherwise.

## 3. Week of Nightmares (102166)

> Only one Week of Nightmares can be played in a game. Put this card in
> play with 10 nightmare counters. Ravnos get +1 bleed and +1 strength and
> do not hunt as normal. Any Ravnos can steal 1 blood from another Ravnos
> as a +1 stealth hunt action. During each Methuselah's unlock phase, that
> Methuselah can move 1 nightmare counter from this card to a Ravnos. If
> this card has no counters, each Ravnos burns 1 blood for each nightmare
> counter on them or is burned, then burn this card and the nightmare
> counters.

**Game-wide uniqueness, at last.** Every "unique" card so far has been
own-duplicate prevention (`seatControlsCopy`), and game-wide uniqueness
was the deferral blocking Open War. It turns out to need no new state at
all: the event log *is* the record of everything that has ever been
played, so the play option asks
`eventLog.some(ev => ev.type === "CardPlayed" && ev.name === …)`. That is
stricter than "in play" and exactly what the card says — a second copy
stays unplayable even after the first one burns. **Open War can use the
same test.**

The rest: one global `aura` carrying the two new fields `bleed` and
`cannotHunt` (the latter read at the hunt option site — an aura that takes
an action away rather than modifying it); a granted action for the
blood steal; and the unlock-phase counter move as an `abilityAnySeat`
ability gated on `ctx.seat === ctx.turnSeat` ("*that* Methuselah").

The payout fires inside the ability that moves the last counter, which is
the only way the card can reach zero in this pool. "Burns 1 blood for each
nightmare counter on them **or is burned**" is read as forced payment: a
Ravnos who can pay must, and one who cannot is burned.

## 4. A third combat-teardown crash

Week of Nightmares can burn a vampire outright, which found one more place
assuming a minion outlives the frame that references it: a **block
attempt whose blocker left play** tried to lock a minion that was gone.
It now fails the block — there is nobody blocking — and the action carries
on. That is the fourth such fix in two sessions; the pattern is in
CLAUDE.md.

## 5. Deviations recorded

- Week of Nightmares' blood steal is "a +1 stealth **hunt** action"; the
  engine announces it as a granted `cardEffect` action with +1 stealth, so
  a card that keys off hunt actions specifically would not see it. No card
  in the V5 pool does.
- `onLeavePlay` fires from `burnPermanent` only. A card removed by ousting
  (the p. 43 sweep) or shuffled into a library does not get the call; no
  card in the pool needs it there today.
- Carver's "after a vampire … goes to torpor" fires on the torpor path
  only, not when a vampire is burned outright — which is what it says.
