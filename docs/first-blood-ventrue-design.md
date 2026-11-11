# First Blood Ventrue (wave 117) — BUILT 0.11.67

The owner approved all three questions in section 2 on November 10, 2026:
Ventrue groups 4–5 are open, João's clause is built as an inert tag, and
Mustafa is limited to once per Toreador per referendum. Section 4 records
what was built.

Target: the First Blood Ventrue precon, 89% before this wave. It is missing
six vampires, all Ventrue groups 4–5. Opening Ventrue groups 4–5 in
`config/crypt-groups.json` needs the owner's approval (CLAUDE.md, Scope).

| Card | Cap | Text (KRCG) | Rulings |
|---|---|---|---|
| Emily Carson (200421) | 5 | Primogen. During your discard phase, Emily can burn the Edge to unlock. | none |
| Graham Gottesman (200533) | 7 | Prince of Miami. (no ability) | — |
| João Bilé (200707) | 5 | While João has no title, he cannot block titled vampires. He gets +1 stealth during actions to put vampires in play. | none |
| Lodin (Olaf Holte) (200848) | 8 | Prince of Chicago. Once each combat, Lodin can prevent 1 damage from an opposing minion's strike. | none |
| Mustafa, The Heir (201026) | 6 | Prince of Istanbul. During the polling step of a political action, each older Toreador controlled by another Methuselah can move 1 blood from themselves to Mustafa to force him to cast his votes and ballots as that Toreador's controller chooses. | [LSJ 20090304-2] first user has priority, last user has the final say; not during an automatically passing referendum [PIB 20150105] [LSJ 19980107] |
| Victor Donaldson (201438) | 6 | Prince of Atlanta. If a card named Golconda: Inner Peace you play is canceled, you can move that card from your ash heap to your library (shuffle afterward). | none |

Graham prints no ability and enters free when the groups open.

## 1. Readings proposed

1. **Emily** is an ability offered in her controller's discard phase while
   that seat holds the Edge and Emily is locked. Using it burns the Edge
   and unlocks her. It reuses the discard-phase ability window that
   `discardPhaseUnlockOnBleed` already opens.
2. **João, first sentence**, is a block restriction read at block time,
   not at play: an untitled João is not offered a block against a titled
   acting vampire. If João gains a title mid-game, the restriction lifts.
3. **João, second sentence.** "Actions to put vampires in play" is read as
   an action whose effect moves a vampire into a controlled region (an
   Embrace-style action). **No action in the current pool does this.**
   Kindred Intelligence moves a card to the uncontrolled region, which is
   not in play. Gather is a vampire-moving card, but its action puts the
   Gather card in play, and the move happens later, in the influence
   phase. Graverobbing's superior is a steal action. The clause is built
   as an action-spec tag, `putsVampireInPlay`, that João's stealth reads.
   No card carries the tag yet, so the clause is whole but inert today.
   The test builds a tagged action in the fixture to prove the stealth
   lands.
4. **Lodin** reuses the existing once-per-combat damage prevention,
   limited to damage from an opposing minion's strike. It doesn't cover
   damage from a card or an environment effect.
5. **Mustafa**:
   - The ability belongs to a **Toreador controlled by another seat**.
     The deciding seat is the Toreador's controller, not Mustafa's
     (the "which seat" lesson in CLAUDE.md).
   - "Older" means higher capacity (p. 6), so the Toreador must be
     capacity 7 or more. Strictly older; an equal-capacity Toreador
     doesn't qualify.
   - The cost is 1 blood moved from the Toreador to Mustafa, capped at
     Mustafa's capacity. If the move would exceed it, the extra blood
     drains to the bank (p. 8).
   - The effect is the existing `changeVotes(Mustafa, side, forceCast:
     true)` from `docs/vote-changing-design.md`, so his whole vote group
     moves one way.
   - The ability can be used once per Toreador per referendum. Without a
     limit, one Toreador could flip the vote back and forth for 1 blood
     each time.
   - The last user has the final say: a later use re-points votes that a
     previous use already cast [LSJ 20090304-2].
   - It isn't offered during an automatically passing referendum
     (`notWhenAutoPassing`).
   - The ability isn't offered when Mustafa has no votes to cast, because
     using it would be futile.
6. **Victor** watches the existing `CardCanceled` event, which now files
   the card in the ash heap (`docs/out-of-turn-cancels-design.md` §5).
   When the canceled card is a Golconda: Inner Peace that Victor's
   controller played and Victor is in play, that seat gets an optional
   choice: move the Golconda to their library and shuffle. Golconda is in
   the pool, and its own text lets its target's controller cancel it.

## 2. Questions for the owner

1. **Open Ventrue groups 4–5?** This admits only whole vampires: the five
   in section 1, Graham, and any other Ventrue groups 4–5 vampire that
   prints no ability.
2. **João, reading 3.** Is building the clause as an inert tag
   acceptable, the way the fourteen whole-but-inert library cards were?
3. **Mustafa, once per Toreador per referendum (reading 5).** The card
   doesn't print a limit, but without one the ability loops. Is that limit
   the one you want?

## 3. Tests planned

One scenario file, `tests/cards/first-blood-ventrue.test.ts`, with a
positive case and the negative space for each card:

- Emily: offered only in your own discard phase, only with the Edge, and
  only while she's locked.
- João: no block on a titled actor while untitled; can block once titled;
  +1 stealth only on a tagged action.
- Lodin: prevents exactly 1, once per combat, and not against
  non-strike damage.
- Mustafa: offered to an older rival Toreador only. Not offered to an
  equal-capacity or own-seat Toreador, or during an automatic pass. The
  last user wins.
- Victor: recovers a canceled Golconda; doesn't trigger for an uncanceled
  one or for another card.

## 4. What was built

- **Emily Carson:** `permanent.unlockForEdge` is now `boolean |
  "discardPhase"`. Kalinda keeps `true` ("during your turn"); Emily's
  value adds a `turn.discard` window gate to the same enumerator.
- **João Bilé:** two new pieces.
  - `PermanentStatics.cannotBlockTitledWhileUntitled`, read in
    `mayAttemptBlock` (`derived.ts`), the one block predicate, so a forced
    block obeys it too.
  - `ConditionalStatic.actionCardTags`, read off
    `ActionAnnounced.cardTags`, which carries the announcing handler's
    `permanentTags`. The tag is `putsVampireInPlay`. A future action card
    that puts a vampire in play declares that tag in `permanent.tags`.
- **Lodin:** `preventByStrikeSource` (Kevlar Vest) gained
  `opposingStrikesOnly`. The option requires the damage item's `source`
  to be the other combatant; `source` is null for environmental damage.
- **Mustafa:** a bespoke overlay (`mustafa` in `cards.ts`) with
  `abilityAnySeat`. The latch is `ReferendumFrame.usesThisReferendum`,
  which dies with the frame.
- **Victor:** a new hook, `CardHandler.onCardCanceled`, fired over
  `allEntries()` in the engine's cancel branch, after the card is filed in
  the ash heap. Victor must be ready; a vampire in torpor uses no
  abilities. That is a reading, recorded here.
- **Admitted:** 11 crypt cards (the six First Blood Ventrue vampires and
  five other Ventrue groups 4–5 vampires that print no ability).
- **Tests:** `tests/cards/first-blood-ventrue.test.ts`, 21 cases. João's
  stealth test tags the announcement event directly, because no card in
  the pool carries the tag.
