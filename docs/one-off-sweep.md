# One-Off Sweep

The reusable-mechanic gates (1–8) are all closed. What remains of the V5
library pool is the one-off tail — each card a thin handler over the
primitives now in place. This doc tracks that sweep: which cards landed,
which shared a small mechanic, and which are parked pending a deferred
system.

## Landed

### Counter one-offs (on the Gate 8 `counters` substrate)

- **Dreams of the Sphinx** (100588) — bespoke unique card; each lock adds a
  counter, burns at 3. Two of three lock abilities modeled (Edge pool gain,
  uncontrolled-blood); the "+2 hand size until end of turn" is deferred
  (temporary hand size is unmodeled — matters only at discard).
- **Powerbase: Madrid** (101437) — bespoke counter location: once-per-unlock
  accumulate (≤3 → +1) + lock-during-polling spend (+1 vote per counter to a
  titled Sabbat). Deviation: the opponent's "burn all counters as a Ⓓ
  action" counter-play is unmodeled.
- **Alamut** (100037) — bleed-success accumulate (new reusable
  `onBleedSuccess` hook: pool lost by a Banu Haqim's bleed → counters) +
  polling burn-X-for-X-votes spend.
- **Dead Pool** (102299) — combat-leave accumulate (new reusable
  `onCombatLeave` hook, fired when a combatant leaves the ready region;
  the optional "you can add a counter" is always taken — deviation) + a
  Lasombra burns a counter for +2 bleed (its own bleed) or +2 votes.
- **Under Siege** (102063) — a +1-stealth action that puts itself in play
  with 3 counters (new `putInPlayOnSuccess` action primitive +
  `putsInPlayOnSuccess` handler hook — reusable for the ~7 "put this card in
  play with N counters" counter actions). Its "once each action, a Sabbat
  vampire burns 1 counter to unlock and attempt to block +1 intercept"
  reuses the whole unlock-and-block cluster; `ActionFrame.usedInPlayAbilities`
  tracks the once-per-action limit; burns at 0 counters.

### Conditional-bonus modifiers (one shared primitive)

`modifyBleed`/`modifyIntercept` gained an optional `bonus { extra, when }`
with a `ModifierCondition` (`selfClan` / `selfTitled` / `actingTitled` /
`targetPoolAtMost`), resolved by `conditionalExtra`. Cards: **Aire of
Elation** (100031, +1 bleed if the vampire is Toreador) and **Protection
Racket** (101501, +1 intercept if the acting minion is titled). The same
primitive is ready for The Warrens (needs a "directed at you" reaction
gate), Foreshadowing Destruction (targetPoolAtMost is built), and
clan-conditional crypt cards.

### Hunting grounds (one shared mechanic, 13 cards)

`permanent.huntingGround { amount, clan? }` compiled generically: "during
your unlock phase, a ready vampire you control can gain N blood; a vampire
uses only one hunting ground each turn." Once per location per turn
(`entry.usedThisPhase`) and once per vampire per turn
(`MinionState.usedHuntingGroundThisTurn`, reset at unlock, set by the
`HuntingGroundUsed` event). Cards: Academic, Asylum, Library, Park,
Political, Slum, Society, Temple, Underworld, Uptown, Warzone, Zoo, Biotech
Company.

### Aggravated hand strikes (one shared primitive)

`handStrikesAggravated` — a per-round `CombatFrame.handStrikesAggravated`
flag folded into hand-strike damage in `resolveStrikes`. Cards: **Claws of
the Dead** (100356) and **Wolf Claws** (102190) — basic aggravates hand
strikes, superior is a plain maneuver / press.

### Misc singletons

- **Thing** (101972) — "+1 stealth action; add 2 blood to a Gangrel in your
  uncontrolled region." Added a `clan` filter to `addUncontrolledBlood`
  (ready for Unholy Sacrament / Magnetic Authority's sect variants).
- **Diversion** (100563) — Anarch combat with three per-discipline modes
  (cel additional strike / for prevent 2 / tha ranged steal-blood +
  maneuver). Added a maneuver/press `riders` field to `strikeStealBlood`
  and a `meetsRequirements` gate to combat cards ("Requires an Anarch").
- **Unholy Sacrament** (102345) — one-shot master: "add 3 blood to a titled
  Sabbat vampire in your uncontrolled region." Extended
  `addUncontrolledBlood` with `sect`/`titledOnly` filters and wired it as a
  master one-shot (options + resolve).
- **Slam** (101798) — `[pot]` strikeHandBonus +2 (superior adds a maneuver
  rider; the printed "only to close range" restriction is a noted
  deviation). Added `riders` to `strikeHandBonus`.

### Intercept-reaction cluster (two shared mechanics)

- `actionDirectedAtYou` usability rule + the blocker-combat-rider
  (`blockerCombatRider` primitive → `ActionFrame.blockerCombatRiders`,
  applied to the blocker's side when its block starts combat, reusing the
  existing maneuver/press credit machinery). Also generalized reaction
  candidate selection so a card can **mix** a locked-vampire mode and an
  unlocked-blocker mode (per-mode lock gate).
- Cards: **The Warrens** (102216, directed-at-you +2 intercept, +1 if the
  Nosferatu is titled), **Eyes of Argus** (100680, directed intercept /
  locked-vampire wake), **Spirit's Touch** (101850, +1 intercept, +1
  maneuver next combat if it blocks).

### Unlock-and-attempt-to-block (kernel mechanic, owner-approved)

docs/unlock-and-block-design.md — a locked vampire's reaction unlocks it and
forces a block on the current action. `ActionFrame.pendingAutoBlock` +
`startAutoBlock` (reuses the whole block-attempt path); ops
`unlockAndAttemptBlock` / `unlockReactingMinion`. **Wave 1 shipped:** Sense
the Savage Way, Sentry Signal, Second Tradition: Domain, Eagle's Sight
(ignore-restrictions), Guard Dogs, Rat's Warning. **Wave 2 — 7 of 8:** One
With the Land (no-strike-first-round), My Enemy's Enemy (redirect to
predator's predator), Dogged Pursuit (did-not-block penalty + self-attach
ability), Cats' Guidance + Forced Vigilance (post-block-resolution unlock
window, via `CombatFrame.fromBlock`), Eyes of the Wild (repeatable
burn-for-intercept, via `ActionFrame.interceptBurnGrants`), and Organized
Resistance (bespoke target-another-Anarch), and **Melange** (attach-on-block
as a seat-level permanent tagged with the actor + a burn-for-bleed overlay)
all shipped. **Wave 2 complete — the entire unlock-and-block cluster (14
cards) is done.**

### Granted actions (new gate — docs/granted-actions-design.md)

A pool survey found **48** unsupported cards of the shape "\<who\> can
\<do Y\> as a \[+N stealth\] \[Ⓓ\] action" — the biggest remaining family,
and much larger than the three cards this doc originally listed. The
design doc splits it into four sub-families and proposes a wave; §6 holds
the questions the owner must settle (reverse the Powerbase precedent?
control change? Open War's scope).

**Owner decisions (2026-08-02):** build directed actions targeting a card
in play (reversing the Powerbase precedent); build control change for
*both* cards in play and minions; do the burn-clause cards before control
change.

Landed so far: the whole kernel (generalized `announceEntryAction` with
target/stealth/cost, `ActionFrame.targetPermanent` / `grantedEffect` /
`grantedCost`, the `resolveGrantedAction` hook, cross-seat enumeration of
every seat's cards in play, and the `permanent.vulnerableTo` compiler that
turns "Minions can burn this card as a Ⓓ action" into a real directed
action blockable only by the card's controller), plus three cards: **Pit
of Contemplation** (102291), **Creeping Sabotage** (102213) and **Army of
Rats** (100093). Pit's own burn clause is now live too, since the
mechanism exists.

**Control change — DONE, both tiers** (docs/control-change-design.md):
control vs ownership on minions and cards in play, the `ControlChanged`
event and ops, the p. 43 oust sweep, and `vulnerableTo.outcome: "steal"`.
Cards: **Powerbase: Montreal** (101439) and **Cave of Apples** (100311).

**Auras — DONE** (`PermanentAura` + `auraBonus`): statics a card in play
radiates onto *other* minions, `scope: "controller"` ("Gangrel you control
get +1 strength") or `"global"` ("Assamites get +1 stealth when
bleeding"), filtered by clan/sect. Plus `attachAnyMinion` masters (put on
any Methuselah's minion, controlled by the player who played it — p. 16)
and a `cannotBlock` static. Cards: **Gangrel Revel** (100807), **The
Khabar: Community** (101042), **Pentex™ Subversion** (101384).

**Choice frames — DONE** (docs/choice-frames-design.md): "the card stops
and asks one Methuselah a question", generalizing the one-off
`DiablerieOfferFrame`. It unblocked all three cards that were waiting on a
decision point, and retired two noted deviations at the same time — Cave
of Apples' and Dead Pool's optional riders are real choices now instead of
auto-taken. Landed with it:

- **The Rack** (101536) — a choice at play *and* on control change
  (`onControlChanged`), stored in `entry.chosen` and read back by the
  unlock-phase clause.
- **Fragment of the Book of Nod** (100785) — a *repeated* choice: draw 2,
  then discard down (no replacement draws), player's pick each time.
- **Powerbase: Los Angeles** (101435) — which needed
  `TurnFrame.discardActionsLeft`: "in your discard phase you receive by
  default one discard phase action" (p. 37) was simply unmodeled.

**Burn-family remainder — 3 of 5 done.** **Brujah Debate** (100260, a
global aura plus a forced lock in every Methuselah's master phase — new
`onMasterPhase` hook, and a ChoiceFrame when several Brujah tie for
oldest), **Mob Connections** (101229, `grantCombatPressTo`), **Powerbase:
Munich** (102301, an Oblivion blood mover, and the first granted action
with a cost actually exercised).

**Burn family COMPLETE** with the last two: **Toreador Grand Ball**
(101989) and **Aranthebes, The Immortal** (100079). Mechanisms built for
them, both reusable:

- **"Does not unlock as normal"**, in both shapes as planned —
  `PermanentInPlay.preventsUnlock` (persistent, Grand Ball) and
  `MinionState.skipNextUnlock` (one-shot, consumed by the next unlock
  sweep). The one-shot form retired a standing deviation on the spot:
  **On the Qui Vive**'s ally rider is implemented instead of a TODO.
  Stolen Police Cruiser wants the same field.
- `PermanentInPlay.unblockable` — "that minion's non-bleed actions cannot
  be blocked".
- Aura extensions: `requiresUnlocked`, `maxCapacity`, and
  `bleedAgainstController` ("vampires with capacity 4 or less get -1 bleed
  against you"), resolved against the bleed TARGET's cards in play.
- `vulnerableTo.outcome: "shuffleIntoLibrary"` — the card leaves play into
  its owner's library, shuffled with the seeded RNG.

Also fixed en route: the p. 20 per-copy limit was a single boolean on the
entry (spending a card for *everyone* after one use) — now
`grantedActionUses: { minion, key }[]`, per minion per action per copy;
and the "during your unlock phase" leak described in design §6.5.

### Counter cards — remaining ledger (grouped by the sub-system each needs)

**8 done at the time of writing (13 now):** Dreams of the Sphinx, Powerbase: Madrid, Under Siege, Alamut,
Dead Pool, Constant Revolution, Smiling Jack, Wasserschloss Anif. Reusable
pieces built: `PermanentInPlay.counters` + add/remove/enter-with-counters
(Gate 8); `putInPlayOnSuccess` action entry; `ActionFrame.usedInPlayAbilities`;
`onBleedSuccess` / `onCombatLeave` / `onAnyUnlock` hooks. Decision (Powerbase
precedent): the opponent "burn this card as a Ⓓ action" counter-play is a
noted deviation on the cards that have it, rather than a new blockable
directed-action-at-a-card system.

Remaining, by the mechanic still needed:

- **Forced-choice unlock-punish variants** — DONE: Week of Nightmares
  (docs/bespoke-economies-design.md).
- **Corruption counters on minions (per-owner)** — subsystem BUILT
  (`MinionState.corruption` keyed by seat + `CorruptionChanged` +
  `addCorruption`/`removeCorruption`). Cards shipped: **The Platinum
  Protocol** (multi-discipline Anarch bleed places a counter),
  **Enchanting Gaze** (burn a counter to fail a corrupted minion's block —
  `BlockAttemptFrame.forceFail` + `corruptFailBlock`), **Revelation of the
  Serpent** (burn 2 counters on a successful bleed to unlock —
  `ActionFrame.corruptionUnlocks`). Still to do: **Cave of Apples** (place
  via a granted Ⓓ action + steal-at-threshold — needs control-change).
- **Counters pay a card's blood/pool cost** — DONE: Ravnos Carnival,
  Ravnos Cache (docs/cost-sources-design.md; `PermanentCostSource` +
  `paymentSplits` + `ActionFrame.costFromCards`).
- **Dynamic hand-size + replacement-draw interception** — DONE: Visit
  from the Capuchin (docs/counter-sinks-design.md).
- **Weapon whose counters deplete per damage / strike-attach +
  unlock-interception** — DONE: Weighted Walking Stick, Touch of Oblivion
  (docs/counter-sinks-design.md).
- **Hostage counters on minions + torpor hook + diablerie gating** —
  DONE: Carver's Meat Packing (docs/bespoke-economies-design.md).
- **Investment cards** — DONE for scope: Wall Street Night. The V5 pool
  has NO investment cards, so its second clause enumerates nothing
  (docs/bespoke-economies-design.md §1).
- **Deferred gates (owner-review per project rule): ash-heap region** — Split
  the Veil, Gate of Acheron (partial); **wraith/zombie allies** — Dance of
  the Dead, Cursed Abattoir, Split the Veil; **Path mechanics (out of scope
  per CLAUDE.md)** — Forward Momentum.

## Parked (need a deferred system)

- **Hunting-ground variants**: Carfax Abbey (baron rider), Papillon (city
  title, 2 blood), Meditative Grove (Salubri + frenzy-cancel), Burial Site
  (Path of Death + wraith/zombie ash-heap allies) — each adds a rider on
  top of the generic mechanic.
- **Most other counter cards** (Powerbase, Dead Pool, Under Siege, Week of
  Nightmares, …) — see docs/counters-design.md; several need granted
  opponent actions, combat-leave triggers, or the ash-heap region.
- **"Unlock and attempt to block" reactions** (Sense the Savage Way, Sentry
  Signal, One With the Land sup, Second Tradition: Domain, Dogged Pursuit,
  Eyes of the Wild, and the "unlock this vampire" cards Guard Dogs / Rat's
  Warning / Cats' Guidance) — the single highest-yield remaining reaction
  lever (~8–10 cards), but it drives the block state machine from a
  reaction, so it's kernel-touching and warrants its own design doc +
  owner review rather than an inline slot-in.
- **Reaction "prevent/reduce to 0" and first-round combat riders**
  (Precognition prevent-first-round, Visions of Zapathasura / Night Terrors
  reduce-to-0) — each a small combat-rider or set-to-zero mechanic on top of
  the cluster above.
