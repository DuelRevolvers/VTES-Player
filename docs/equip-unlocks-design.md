# The actor unlocks after the equip — wave 106

Four legacy library cards that print the same promise: if the action to equip
with, or recruit, this card is successful, the acting minion unlocks later
that turn. Each card has a second clause the engine did not have.

| Card | Id | The promise | The second clause |
|---|---|---|---|
| Baseball Bat | 100137 | Unlock at the end of the turn | Do not replace until after this action; strength+1 melee weapon |
| Leather Jacket | 101081 | Unlock at the end of the turn | Burn it to prevent all damage from the opposing minion's strike; one per minion |
| Powder of Rigidity | 101427 | Unlock during the next discard phase | Burn it before range: the opponent cannot use Protean or Vicissitude cards this combat; a werewolf gets −2 strength |
| Repo Man | 101605 | Unlock at the end of the turn | +2 stealth action: retrieve the first vehicle in your library and place it on a minion you choose |

Version 0.11.44. Tests: `tests/cards/equip-unlocks.test.ts` and
`tests/ai/equip-unlocks.test.ts`.

## §0 Why these four, and why none is inert

The family was picked by mechanic: every unbuilt T1 card that prints "unlock
the acting minion" after its own equip or recruit. Four more print a close
cousin and were left out because their second clause belongs to a different
family: Border Skirmish (an action directed at every other Methuselah),
Tapestry of Blood (looking at another library), Big Game (Red List minions)
and Ghoul Messenger (Laibon). Their pools weren't checked for this wave.

Each target the cards name exists in the pool:

- Protean is a V5 crypt Discipline, so Powder's bar can bite.
- Double Deuce is a werewolf ally, so the −2 strength can land.
- Six vehicles are supported, so Repo Man can find one.

## §1 Rules read

- **p. 20:** an equip action is an undirected +1 stealth action, and the
  equipment is burned if the action fails.
- **p. 16:** a burned card goes to its owner's ash heap.
- **[LSJ 20001120]:** Baseball Bat isn't replaced when the action is blocked.
  It's replaced when the action ends, after all combats.
- **[LSJ 20101021]:** the replacement comes after every "after resolution"
  effect.
- **[LSJ 20080702-2]:** put into play some other way (Concealed Weapon), the
  Bat is replaced immediately.
- **[LSJ 20001114]:** Leather Jacket can't be used with no damage to prevent.
- **[RTR 19941109] [RTR 20010710]:** paying for Repo Man's vehicle isn't
  optional when a minion can take it, even when paying ousts.
- **[ANK 20200203-2]:** ghouls are monsters, not mortal.
- **[LSJ 20080619]** (NRA PAC): the unlock promise belongs to the minion and
  outlives the card that made it.

## §2 The unlock promise

`CardSpec.successUnlocksActor` is `"endOfTurn"` or `"discardPhase"`.
`compileSpec` copies it onto the handler. `enterPermanentFromAction` reads it
at the one point where an equip or recruit is known to have succeeded, the
same place NRA PAC's flag is set.

- `"endOfTurn"` sets the existing `MinionState.unlocksAtEndOfTurn`, which
  `endTurn` already spends.
- `"discardPhase"` sets the new `MinionState.unlocksInDiscardPhase`. It's spent
  as the next discard phase opens, beside Mirror Walk's held draw. Powder says
  "the next discard phase", not "your next". An equip happens on your own
  turn, so in practice it's your discard phase.

Both flags live on the minion, so burning or stealing the card later that turn
doesn't cancel the unlock.

## §3 Replacement, and the defect the Bat found

**Defect: an action card's own "do not replace until after this action"
replaced at once.** `scheduleReplacement` deferred `afterAction` only when an
action frame already existed. An action card announces its action when it
resolves, so for its own play there was no frame yet, and the code fell
through to the immediate draw. Arson, Bum's Rush and New Management have
replaced immediately since they were admitted. No test covered any of them.

The fix is a new held replacement, `{ kind: "ownAction" }`, returned for an
action card's own `afterAction`. When the card resolves, `resolveCardPlay`
moves the draw onto the action it just announced (`af.drawAfter`). A card
that announced nothing replaces immediately. A card cancelled as played is
replaced normally [LSJ 20080630], through `releaseHeldReplacement`.

The other side of the Bat ruling is `playCardFromHand`, the path for a card
put into play with no action of its own. It passes `noOwnAction`, so
`afterAction` doesn't wait on whatever action happens to be running.

Leather Jacket's burn is `equipmentAbilities.burnToPreventStrike`, a sibling
of Blood Tears of Kephran's `burnToPrevent`. It's offered in damage resolution
only when the item being resolved is on the bearer, comes from the other
combatant (`source`), and has damage left. It prevents all of it. "A minion
may have only one" is the existing `exclusiveKey`.

## §4 Powder of Rigidity's bar

`equipmentAbilities.burnToBanDisciplines` is offered in
`combat.beforeRange` of the bearer's own combat, beside `burnToEndCombat`.
Burning it calls the new op `banDisciplineCardsThisCombat`. The op records
`{ minion, disciplines }` on `CombatFrame.disciplineBans`, so the bar dies
with the combat.

One private reader, `bannedInCombat`, is asked by both option gatherers:

- `handlerOptions` drops a `playCard` option for the barred minion, from the
  hand and from a store (Gift of Proteus).
- `abilityOptionsFor` drops the abilities of a card attached to the barred
  minion when that card required the Discipline.

"A card requiring Protean" means a card that requires it in any mode, which
is the reading `docs/store-plays-design.md` §4 took for Gift of Proteus. The
question is now one exported function, `cardRequiresDiscipline` in
`derived.ts`, and the store filter calls it too.

A werewolf is a minion whose own card carries the `werewolf` tag (Double
Deuce). It gets −2 strength through `addCombatStrengthTo`.

## §5 Repo Man

The action is the bespoke `repoMan` handler, built on Vast Wealth's granted
search (`searchEquipGrant`) with the bearer chosen rather than fixed.

1. The first card in the library whose handler tags it `vehicle` is the one
   found, whoever can use it.
2. `repoManBearers` lists the ready minions you control that can take it:
   printed requirements, own-copy uniqueness, one vehicle per minion, and a
   minion that can't have equipment. These are the gates
   `playFromHandChoices` applies to a vehicle from the hand. Repo Man himself
   counts; "ready" means in the ready region, not unlocked.
3. With at least one bearer, the controller chooses. The choice has no
   decline, because paying is mandatory. `playCardFromHand` from the library
   pays the cost, and a pool cost can oust.
4. With no bearer, the vehicle is burned without cost. The existing
   `LibraryTopBurned` event carries it to the ash heap; its reducer finds the
   card by id, so the card needn't be on top.
5. The library is shuffled afterward in every case.

## §6 The bots

Every `useAbility` scores the flat `playCard` value, which suits Leather
Jacket: preventing damage is worth a card that has no other use.

Powder has no other use either, but burning it against an opponent with no
Protean, no Vicissitude and no werewolf tag does nothing. So the policy scores
that burn below passing and keeps the card. It reads the viewed minion's
printed Disciplines and tags directly, because `heuristic.ts` may not import
`derived.ts` (`tests/ai/heuristic.test.ts`).

Repo Man's action and choice use the generic scores.

## §7 Measured

A 150-seed fuzz with the four cards in the decks passes, and offered: the Bat's
strike 8 times, the Jacket's burn 2 times, Powder's burn 9 times, Repo Man's
action 44 times and his bearer choice 14 times. 300 games on the default and
the politics tables: 0 errors.

## §8 Open questions for the owner

**Answered October 23, 2026: the owner accepted all five readings as
built.**

1. **"Meets the requirements" for Repo Man's vehicle** also excludes a minion
   that already has a vehicle, a minion that can't have equipment, and a
   second copy of a unique vehicle. Read narrowly, it would place a second
   vehicle where the vehicle's own text forbids one.
2. **"The first vehicle you find"** is the first vehicle in the library, even
   if nobody can take it (it's then burned). Vast Wealth's "first equipment"
   was read as the first one the bearer can use. Repo Man's own fallback
   sentence is why this reading differs.
3. **Powder's "cannot use cards"** covers playing them and using a card in play
   on that minion that required the Discipline. A card requiring Protean only
   at superior is barred at basic too (the store-plays reading).
4. **Leather Jacket** prevents only damage whose source is the opposing
   minion. Combat-round damage with no source (Carrion Crows) isn't "the
   opposing minion's strike".
5. **The replacement fix changes three cards already in the pool.** Arson,
   Bum's Rush and New Management now replace when their action ends, as
   printed, instead of when played.
