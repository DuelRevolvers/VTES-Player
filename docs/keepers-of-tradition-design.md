# Bundle A: Keepers of Tradition Toreador and Ventrue

**Status: §0 APPROVED as written (2026-11-25). Wave 120 BUILT (0.11.70);
waves 121 and 122 not started.**

This is bundle A from `precon-bundles-plan.md` §2. It finishes two legacy
precons: Keepers of Tradition Toreador (82%) and Keepers of Tradition
Ventrue (75%). The two decks miss 14 cards between them and share none.
No clan opening is needed, because Toreador and Ventrue groups 4–5 are
already open. When the last wave lands, both decks reach 100% and join
the chooser (`libertine-ball-design.md` §5).

The 14 cards split into three waves by mechanic, so each wave stays 3–6
cards (the binding rule in `CLAUDE.md`).

| Wave | Theme | Cards |
| --- | --- | --- |
| 120 | Combat | Eugene, Gotsdam, Psyche!, Armor of Vitality, Beretta 9mm |
| 121 | Votes and elders | Gustav Breidenstein, Esgrima, Honor the Elders, Johannes Castelein, National Guard Support |
| 122 | Titles and protection | Rafael de Corazon, Hardestadt, Approximation of Loyalty, Martinelli's Ring |

## 0. Decisions for the owner

1. **The wave split and order.** The table in the preceding section is the
   proposal: combat first, because it has the fewest open rules questions,
   then votes, then titles. Confirm, or reorder.

2. **Johannes Castelein brings Dementation into the crypt.** He prints
   superior Dementation (DEM). No vampire in the pool has it today, so he
   becomes the first. His own ability doesn't use Dementation, so he is
   whole without any Dementation card. Two side effects:
   - Library cards that require Dementation stop being inert (§0 of
     `plain-allies-design.md`), so they become candidates for later waves.
   - Martinelli's Ring's Dementation clause becomes live (wave 122).

   Confirm that admitting him is fine.

3. **When Esgrima can lock.** The card says "Lock during the referendum of
   a political action to give 3 additional votes". It has no ruling on
   timing. Votes are cast in the polling step (p. 28), so the design
   offers Esgrima **during polling only**, like Gustav's "+5 votes during
   the polling step". The 3 votes go to the controller of the chosen
   vampire, which can be any vampire with capacity 7 or more at the table,
   not only one you control. Confirm both readings.

4. **National Guard Support's counter votes.** The card says "in that
   referendum, each counter represents a vote in favor of burning the
   card". The design adds those votes to the FOR side of the tally as
   votes that belong to no Methuselah. That means an effect that cancels
   a Methuselah's votes can't touch them, and they count when the
   engine checks whether a referendum is already decided
   (`referendumDecided`). Confirm.

5. **Martinelli's Ring and the bearer's own cards.** The card says the
   bearer "cannot have or be the target of" cards requiring Malkavian,
   Malkavian antitribu, Dementation or Serpentis. Its ruling narrows the
   bearer's own plays: "the bearer cannot use [ser] or [dem] cards on
   themselves" [LSJ 20080212]. The card's own ruling wins (owner ruling,
   November 25, 2026), so the design reads it this way:
   - The bearer can't be the target of such a card, from any player.
   - The bearer can still play a Serpentis or Dementation card that
     targets someone else.
   - A card the bearer would play on themselves, like Mummify, isn't
     offered.
   - Any such card already on the bearer burns when the Ring arrives.

   Confirm.

## 1. Wave 120: combat

| Card | Kind | What it needs |
| --- | --- | --- |
| Eugene | Vampire (Toreador 4) | "Once each combat, strike: dodge." Tutu (`cards.ts`) is the precedent. |
| Gotsdam | Vampire (Ventrue 4) | A strike: combat ends that costs 1 blood; aggravated damage treated as normal for the whole combat; frenzy cards can't be played on him. |
| Psyche! | Combat (Celerity) | Basic: press. Superior: queue a combat with the opposing minion when combat is about to end. |
| Armor of Vitality | Combat (Fortitude) | Prevent 3. Superior: destroy the opposing minion's melee weapon if it dealt any of the damage. |
| Beretta 9mm | Equipment | A gun whose strike becomes 2R, with one maneuver each combat, while the bearer has a second Beretta. |

What exists already:

- **Gotsdam:** the combat-ends strike (`combatEndsStrike`), the
  aggravated-as-normal flag (`aggravatedAsNormalRound`, today per round
  only) and the frenzy bar (`frenzyImmune`, today set by a card for one
  combat). Gotsdam needs all three as **standing** traits of the vampire.
- **Psyche!:** the queue (`queuedCombats`) and the "combat would end"
  window that Telepathic Tracking uses (`round-end-design.md`). Its
  rulings add three rules: no Psyche! if a combat is already queued, an
  after-combat effect of the combat that ended is lost except unlock
  effects [LSJ 19980109], and the new combat is still part of the
  current action [LSJ 20021213].
- **Armor of Vitality:** prevention, and `destroyWeapon` on the outcome.
  The new part is the condition: only a melee weapon, and only if some of
  the prevented damage came from it.

The new part is **Beretta 9mm**: a weapon whose profile depends on
whether the bearer holds another copy. The rule "a minion may use only one
Beretta 9mm to maneuver each round" means the maneuver is per minion, not
per card.

## 2. Wave 121: votes and elders

| Card | Kind | What it needs |
| --- | --- | --- |
| Gustav Breidenstein | Vampire (Ventrue 4) | Lock in polling for +5 votes. +1 bleed. |
| Esgrima | Master: trifle | A seat permanent that locks for 3 votes to a vampire with capacity 7 or more; passes to your predator in your discard phase. |
| Honor the Elders | Political Action | Each ready vampire with capacity 8 or more, at every seat, and each in an uncontrolled region gains 1 blood. |
| Johannes Castelein | Vampire (Ventrue 4) | If his political action card or his referendum is canceled, the canceling Methuselah burns 2 pool. |
| National Guard Support | Political Action | Put in play on success. −1 stealth on all directed actions. A counter each unlock phase. Any vampire can call a referendum to burn it, with the counters as FOR votes. |

What exists already:

- **Gustav and Esgrima:** a lock in polling for votes (the "lock to give
  each Lasombra +1 vote" clause in `cards.ts`), and the handover to your
  predator in your discard phase (The Coven).
- **Johannes:** the `onCardCanceled` hook from wave 117
  (`first-blood-ventrue-design.md`).
- **National Guard Support:** the "any vampire can call a referendum to
  burn this card" grant (Camarilla Threat). The counter votes (§0, item
  4) and the table-wide stealth penalty are new. "You may not play this
  card if another National Guard Support is in play" is a play gate.

## 3. Wave 122: titles and protection

| Card | Kind | What it needs |
| --- | --- | --- |
| Rafael de Corazon | Vampire (Toreador 4) | A rival contesting his title must yield in their unlock phase. +2 bleed. |
| Hardestadt | Vampire (Ventrue 4) | The same forced yield. +1 bleed, +2 strength. |
| Approximation of Loyalty | Action Modifier (Presence) | Requires capacity 7 or more. Basic: as the action is announced, a vampire with capacity 6 or less, or an ally, can't block. Superior: cancel a reaction played by one of those. |
| Martinelli's Ring | Equipment | The bar on Malkavian, Dementation and Serpentis cards (§0, item 5). |

What exists already:

- **Rafael and Hardestadt:** the unlock-phase contest settlement
  (`settleUnlockContests` in `engine.ts`) already forces a yield for a
  vampire in torpor or with no blood. A rival of a "must yield" vampire
  joins that forced list. It needs no question, because the card leaves
  no choice.
- **Approximation of Loyalty:** "as the action is announced" plays
  [ANK 20190425], and cancel-as-played reactions (`out-of-turn-cancels-design.md`).
  The capacity filter on blockers is new.

## 4. What the build found

Filled in as each wave lands.
