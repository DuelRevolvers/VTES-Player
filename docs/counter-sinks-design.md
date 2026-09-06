# Counter sinks — "instead of X as normal, burn a counter from this card"

Status: **design + implementation** (2026-08-29). Continues the
counter-card ledger in `docs/one-off-sweep.md` after
`docs/cost-sources-design.md`.

## 1. The shape

Three of the remaining counter cards spend their counters *in place of*
something the game would otherwise do, and burn themselves when empty:

**Visit from the Capuchin** (102126, unique master)

> Put this card in play with 4 counters. You get +1 hand size for each
> counter on this card. Each time you would replace a card other than
> this card, instead burn 1 counter from this card. Burn this card if it
> has no counters.

**Touch of Oblivion** (102283, combat, [obl], 2 blood) — inferior

> Strike: put this card on the opposing minion with 2 counters. The
> attached minion burns 1 counter from this card instead of unlocking as
> normal. If this card has no counters, burn it.

**Weighted Walking Stick** (102169, combat) burns a counter per point of
damage its strike inflicts, which is the same "spend a counter when the
game does X" idea keyed to damage rather than to a game step.

The first two share one mechanism exactly, so they are built together:

```ts
/** PermanentInPlay.counterSink */
{ instead: "replacement" | "unlock"; burnWhenEmpty?: boolean }
```

Denormalized onto the card in play at entry, like `statics`, `aura` and
`costSource`, so the interception points need no registry lookup.

## 2. Where the interceptions go

**Replacement draws.** `drawToReplace` is already the single funnel for
every draw in the engine, but it serves two different things: actual
replacements ("whenever you play a card from your hand, you draw another
to replace it", p. 7) and plain draw-ups (a hand-size increase, "draw N
extra cards"). Only the first is what the Capuchin intercepts, so the
method takes a `kind: "replace" | "extra"`, defaulting to `"replace"`,
and the two draw-up callers — `reconcileHandSize` and the `drawCards`
op, which already documents itself as "extra cards, not replacements" —
pass `"extra"`. The deferred replacements (`delayedDraws`,
`ActionFrame.drawAfter`) stay replacements, as does the discard-phase
discard and the political-card-for-a-vote burn.

**Unlocking.** The unlock sweep already asks whether a minion's unlock is
suppressed (`skipNextUnlock` one-shot, `unlockSuppressed` persistent). A
counter sink is a third answer: the minion does not unlock *and* the card
pays a counter for it. It is checked before the other two, because a card
that is paying to hold the minion down should not also spend a one-shot
suppression that some other card set up.

## 3. Dynamic hand size

`PermanentStatics.handSize` is a fixed number folded at entry. The
Capuchin's is `+1 per counter`, so it needs a flag —
`statics.handSizePerCounter` — and one line in `handSizeOf`, which is
already recomputed from the cards in play on every read.

The two clauses balance each other, which is the whole card: it arrives
with 4 counters and the hand is drawn up by 4; every replacement
thereafter burns a counter instead of drawing, so the hand and the hand
size fall together by one each time and no discard-down is ever needed.
Four cards now, four replacements later.

## 4. Weighted Walking Stick — a combat card that becomes a weapon

> Only usable before range is determined during the first round. Put this
> card with 5 counters on it on this minion; it becomes a melee weapon
> equipment that can strike: strength+1 damage. For each damage inflicted
> by this strike (even if prevented), burn 1 counter from this card. Burn
> this card if it has no counters. A minion can have only one Weighted
> Walking Stick.

Three pieces, two of them reusable:

- **`attachSelfWeapon`**, a combat-card effect primitive that puts the
  played card on its own player as equipment. It maps to
  `combat.beforeRange`, where the existing `onlyFirstRound` usability rule
  already gates the round.
- **`Strike.depletesCard`**, set by `chooseWeaponStrike({ depletes: true })`
  and spent in `inflict` at the moment damage is inflicted — which is what
  "even if prevented" means: prevention happens later, in damage
  resolution, and never hands the counters back.
- The weapon strike itself is bespoke. The weapon ability normally comes
  from `compileEquipment`, and this card is a combat card, so the handler
  spreads the compiled combat card and adds the `abilityOptions` /
  `useAbility` pair by hand.

## 5. Two latent crashes this surfaced

Touch of Oblivion's superior is the first effect that removes a combatant
*during* strike resolution, and the widened fuzz decks found two places
that assumed both combatants outlive the combat frame. Both were reachable
before (a burned ally) and both are now total:

- `retainerDamage` looked up each combatant with `getMinion` after strikes
  resolved.
- The combat-card option enumeration did the same while the frame wound
  down through its End of Round step (p. 32), which still happens after
  the combat has "ended immediately" (p. 30).
- `currentIntercept` also threw for a blocker that had left play mid-
  action; its attachments are gone, and the event-log fold still holds, so
  it now treats a missing minion as contributing nothing.

## 6. Deviations recorded

- "Each time you would replace a card **other than this card**": the
  Capuchin is a master, so it is never itself replaced while in play —
  the exclusion has nothing to bite on and is not modelled.
- Nothing in the pool gives a seat two replacement sinks at once; the
  interception takes the first it finds with counters left, which is
  well-defined but arbitrary if that ever changes.
