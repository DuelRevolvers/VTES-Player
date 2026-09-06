# The wraith/zombie gate — 14 cards

**Unblocked by the owner on 2026-09-02.** It had been on the BLOCKED list
since the roadmap and was the single largest blocker in the pool — larger
than the ash heap was (9 cards) when that was unblocked the day before.
It gates 7 Ally, 2 Action, 2 Action Modifier, 2 Master and 1 Reaction,
which is **every remaining ally and the last reaction in the game**.

| Card | id | Type |
|---|---|---|
| Screamer | 102292 | Ally |
| Bone Shambler | 102293 | Ally |
| Shadow Sentinel | 102294 | Reaction |
| Spectral Servitor | 102296 | Ally |
| Split the Veil | 102297 | Action |
| Paths in Two Worlds | 102300 | Action Modifier |
| Rotting Behemoth | 102304 | Ally |
| Burial Site Hunting Ground | 102311 | Master |
| Cursed Abattoir | 102313 | Master |
| Dance of the Dead | 102314 | Action |
| Fiorella, Empty One | 102322 | Ally |
| Gifts From Hereafter | 102325 | Action Modifier |
| Gravebound Drone | 102326 | Ally |
| Heartrender | 102327 | Ally |

---

## 1. The finding that sizes the whole gate

**"Wraith" and "zombie" appear NOWHERE in the V5 rulebook.** Not in the
Allies section (p. 11), not in Important Terms, not in the glossary. Even
**"ghoul" appears only as flavour** — *"A mortal who drinks the blood of a
vampire but has not been drained beforehand"* (glossary, p. 45) — and
never as a game term.

So a wraith and a zombie are **ordinary allies with a printed sub-type**,
exactly like the ghouls already in the pool. The word does one job: other
cards filter on it. Nothing about being undead changes how a minion
blocks, bleeds, takes damage or dies.

**This is the opposite of the Stun situation.** Stun needed an owner
ruling because the word appeared on two cards and was defined by nobody.
Here the fourteen cards each say in full what they do, and the sub-type
they share carries no rules — so the gate needs **no ruling and no new
rules subsystem**. What is left is one filter plus the ordinary work of
fourteen individual cards.

The blocked list was right that this is a gate. It was wrong about what
kind: it is a *vocabulary* gate, not a *mechanics* gate.

## 2. The sub-type needs NO new state

An ally's card text already rides into play as a **self-attached entry**
(`docs/allies-retainers-design.md`), and `permanent.tags` on that entry is
already how "ghoul" is expressed — War Ghoul and the four Vozhd carry it,
and Fleshforge Chamber already filters on it. A **retainer** *is* a
`PermanentInPlay` and carries its tags directly.

So the whole sub-type is one derived helper over state that already
exists:

```ts
/** The printed sub-type of a MINION: an ally carries its card text as a
 *  self-attached entry (`card.id === minion.id`), so its tags live there.
 *  Reading every attached entry would be wrong — a ghoul RETAINER on a
 *  wraith would make the wraith a ghoul. */
export function minionTags(m: MinionState): string[];
export function isUndeadAlly(m: MinionState): boolean; // wraith or zombie
```

`Cursed Abattoir` says "a zombie **(ally or retainer)**" and `Heartrender`
says "a non-wraith non-zombie **ally or retainer**", so both halves are
needed and both are one line.

**Nothing is stored, no event changes, no fixture moves.** The tag half of
the §0 costing was not merely cheap; it is free.

## 3. "Another copy of this ally you control" is a QUERY, not state

Bone Shambler and Gravebound Drone were costed in §0 as needing real work
because they "reason about another copy of themselves". They do — and the
reasoning is a lookup, because a minion already knows its own name:

```ts
otherCopies(state, self) =>
  seat(self.controller).minions.filter(m => m.name === self.name && m.id !== self.id)
```

That is the same lesson as game-wide uniqueness reading the event log
(Week of Nightmares, Open War): **the record already exists, so the card
is a question, not a new field.** Both cards are data on top of it.

## 4. What actually needed building

Everything else was already in the vocabulary, which is why this reads as
a long table of small clauses rather than a kernel change:

| Clause | Lands on |
|---|---|
| "wake a chosen ally" (Shadow Sentinel superior) | the existing wake, aimed at another minion |
| "only one between their unlock phases" | `MinionState.playedSinceUnlock` — already there |
| "prevent damage to another copy … in combat" | `preventDamageFor` (built for Martyr's Resilience, the bystander path) |
| "1 maneuver or press to an ally" | `grantManeuverCreditTo` / `grantCombatPressToMinion` (combat-attachments wave) |
| "burn 1 life to get 1 press" | `allyAbilities.burnLifeForPress` (cheap-tail wave) |
| "enter combat as a Ⓓ action costing 1 life" | `permanent.rushGrant` + `grantedCost` |
| "+1 stealth, even if not yet needed" | `evenIfNotNeeded` (action-time-locations wave) |
| "by a ready unlocked vampire other than the acting minion" | `byOtherUnlockedVampire` (other-vampire-modifiers wave) |
| "burn this ally to have the action fail" | `failAction()` (Expulsion; Szlachta Bodyguard prints the same clause) |
| "remove itself from the game" | `removeMinionFromGame` (cross-table-masters wave) |
| "plays cards as a vampire" | `ally.playsAsVampire` (Vozhd wave, p. 11) |
| "burn counters, then burn this card" | the counter substrate (Gate 8) |

New, and each earns its keep:

- **`ally.subtype`** — sugar that puts the printed word in `permanent.tags`
  so a card cannot declare its sub-type in one place and be filtered in
  another.
- **`allyAbilities.lockForGrant`** — Fiorella's "lock to give another
  wraith or zombie ally +1 stealth **or** +1 intercept". City Star Taxi's
  `lockForStealth` is the same clause with one grant and a clan filter;
  this generalizes it rather than adding a third spelling. **The recorded
  structural limit stands**: `permanent.lockGrant` is compiled inside
  `compileMaster` and still cannot reach an ally. Ally is still only the
  *second* card type to want it, so the lift is still not due (CLAUDE.md's
  "worth doing when a third card type needs it").
- **`ally.cannotEquip`** — "this ally cannot have or use equipment (or
  retainers)". A gate on **options**: the ally is not offered as a bearer.
- **`ally.cannotGainLife`** — Rotting Behemoth. Read where life is added,
  not where it is spent.
- **`ally.actsWhenRecruited`** — `cannotActThisTurn` is set from
  `ev.recruited` (p. 22); Spectral Servitor is the first card to print an
  exemption.
- **`ActionAnnounced.cardTags`** — Paths in Two Worlds is usable only as
  an action recruiting "a wraith or zombie" is announced. `cardTypes` was
  already stamped on that event for the conditional-statics wave; this is
  its sibling, off the same central query (`permanentTags`).
- **`ops.returnAllyFromAshHeap`** — Split the Veil, and the only genuinely
  new *capability* in the gate (§5).

## 5. Split the Veil — the first minion to come BACK

> If this card has no counters, burn it and move a wraith or zombie ally
> from your ash heap to your ready region with life equal to its starting
> life.

Every other ash-heap card moves a *library card* (Garibaldi's exchange,
Psychophagia). This one **puts a minion back into play**, which nothing
had done. It needs no new zone: the ash heap holds `CardInstance[]`, and
`EngineOps.registry` (built for the library-search wave, so a search can
read the type and cost of what it finds) answers `isAlly` and
`allyEntry`, which is exactly what `AllyEnteredPlay` wants.

Two readings on record:

- **It is not a recruit**, so `recruited: false` — the ally is *moved to
  the ready region*, not played as an action, and p. 22's "cannot act the
  turn it is recruited" does not apply. The card says "move", and there is
  no recruit action to be blocked.
- **"With life equal to its starting life"** is `allyEntry().life`, the
  printed value — the same number `capacity` records for a minion already
  in play, which is why "not to exceed its starting life" elsewhere reads
  `capacityOf` (the outside-combat wave's finding).

## 6. Two clauses that correctly do nothing, and why they still ship

The Wall Street Night standard: a card is honestly supported when its
clauses work, and a clause with nothing to match is worth having when the
rest of the card plays. Both go in `docs/partial-support.md`.

- **Burial Site Hunting Ground** — "a ready vampire you control **who
  follows the Path of Death and the Soul** can gain 1 blood, **or** a
  wraith or zombie ally you control can gain 1 life". Paths are **out of
  scope per the scope lock**, so the first branch is written and
  enumerates nothing; the ally branch is whole. This card is the one that
  sits on *both* blocked lists, and unblocking wraiths does not unblock
  Paths.
- **Rotting Behemoth** — "remove **an ally or vampire** in your ash heap
  from the game". **Burnt vampires are deliberately not modelled in the
  ash heap** (`docs/ash-heap-design.md` records the omission: a
  `MinionState` is not a `CardInstance`, and crypt is phase 7), so the
  vampire half correctly matches nothing today and the ally half works.
  When phase 7 puts crypt cards in the heap, this card gains the other
  half for free.

## 6a. Three real bugs the wave found, all the same shape

Each is a piece of machinery that existed, was documented as general, and
quietly did not apply to one case — invisible until a card needed it.

1. **An ally's entry never merged its MODE's statics.** A retainer's
   `permanentEntry` has always done `{...permanent.statics, ...mode.statics}`;
   `compileAlly.allyEntry` copied only the card-level ones. So a
   superior-only clause expressed as mode statics was **silently inert**,
   which would have hit Bone Shambler, Gravebound Drone and Rotting
   Behemoth's superiors at once. Found because Spectral Servitor's
   superior offered nothing.
2. **The ally entry path never fired `onEnterPlay`.** The hook is
   documented as firing "from both entry paths"; the equipment/retainer
   path called `notifyEnterPlay`, the ally path did not. So
   `onEnterPlay` was dead for every ally in the game. Rotting Behemoth's
   "after this ally enters play…" is the first card to need it.
3. **`compileSpec` installed its ChoiceFrame dispatcher mid-function**,
   before several clauses had registered their keys — and installed it at
   all only `if (Object.keys(choiceByKey).length > 0)`. A clause
   registering a key *below* that point therefore found no dispatcher
   installed and its question was **never asked**. It is now installed
   last, after every registration. This is the `choiceByKey` idea's own
   failure mode: the map made two clauses safe to coexist, and the
   *ordering* of its consumer was the thing left unguarded.

The common lesson is the one this project keeps relearning: **a filter or
a hook that is empty for the wrong reason looks exactly like one that is
correctly empty**, and neither the type checker nor the fuzz can see the
difference. All three were caught by a card that needed the feature and a
test that asserted the positive case.

## 7. Readings on record

- **Screamer's two clauses have different windows.** "Burn to give a
  minion controlled by your predator or prey −1 stealth" is a stealth
  effect and lives where stealth is read (during an action); "burn as an
  action directed at an ally you control is announced to have it fail" is
  the Szlachta Bodyguard clause verbatim — the action **fails**, so no
  combat follows and the blocker is never involved.
- **A stealth REDUCTION is offered only when it can matter**, the mirror
  of p. 26's only-when-needed rule that `modifyBlockerIntercept` already
  takes. A card that cannot change whether a block succeeds is not
  offered.
- **Spectral Servitor's "non-action cards"** narrows p. 11's
  play-as-a-vampire: `playsAsVampire` puts Disciplines on the ally and
  every enumerator reads `disciplinesOf`, so the restriction is a filter
  at the one place action cards are enumerated, not a second mechanism.
- **Heartrender removes ITSELF as the cost of its own action**, so the
  action's actor is gone by resolution. The removal is therefore part of
  resolution, not announcement — announcing an action with a minion that
  has already left play is not a thing the engine can express.
- **"Non-wraith non-zombie"** is a negative filter, and it is the sharpest
  test the sub-type gets: Heartrender cannot burn its own kind, so the
  test needs one victim of each kind and asserts both directions.
