# Allies whose Ⓓ action destroys a card in play

Tranche 3, wave 25. Three allies, one sentence each, one action between
them.

| Card | KRCG | Printed |
|---|---:|---|
| The Bruisers | 100259 | Unique mortal, 2 life / 2 strength. "May take a Ⓓ action to burn a **location controlled by your prey**." |
| Arcanum Investigator | 100083 | Mortal, 2 life / 1 strength. "As a Ⓓ action, can burn an **equipment** possessed by a minion controlled by your **predator or prey**." |
| Felix "Fix" Hessian | 100719 | Unique wraith, 2 life / 1 strength / 1 bleed. "Can burn a **location** as a **+1 stealth** Ⓓ action that **costs 1 pool**." |

These are whole cards: each prints stats and exactly one clause, so
nothing is deferred and there is no second half to argue about.

## §1 — The action already existed; the grant did not

`actionOnPermanent { what, outcome }` has burned locations and equipment
since Conceal and Arson — from an **action card**. `permanent.grantedAction`
has offered a minion an action from a **card in play** since the crypt
waves, with six arms. Neither could say "this ally, on its own, burns that
card": the arms were `addBlood`, `stealEquipment`, `ashExchange`,
`reviveAlly`, `reorderTop`, `stripMinion`, `burnSelfForBlood` — every one
of which either gives something or takes it, and none of which destroys.

So `burnPermanent` is a seventh arm, carrying `what` and `scope`. It rides
the machinery that was already there and is documented in
`docs/crypt-wave-5.md` §1: enumerate one option per legal answer, **fix it
at announcement** (p. 25), pay at resolution (p. 27), route back through
`resolveGrantedAction` by effect key. A blocked action therefore costs
nothing and burns nothing, which is the whole reason that shape exists.

The target rides as `targetPermanent`, so the action is **directed at the
card's controller**, who alone may block. That is [LSJ 20090324] for
Arcanum Investigator in particular — *"his action is directed against the
Methuselah controlling the equipment, not the minion it's on"* — and it
needed no special handling, because a permanent target has always meant
its controller.

## §2 — Scope is a gate on the OPTION

Each card names a different set of victims, and each is checked where the
options are built rather than at resolution:

- **prey** (The Bruisers),
- **predator or prey** (Arcanum Investigator),
- **any other Methuselah** (Felix).

Never your own cards. Felix's text is unqualified — "burn a location" —
and so is Arson's, which has excluded the acting seat since it was built;
these are Ⓓ actions, and a directed action aimed at yourself is a
contradiction the rest of the engine is not built to answer. Following
Arson keeps one convention rather than two.

Gating the option rather than the resolution matters for a third reason:
a target that was never legal should not be **announceable**, because
announcing it locks the ally and spends its action.

## §3 — A pool price on a granted action

`grantedAction` could charge blood and not pool. For Felix that is not
interchangeable: **an ally's blood IS its life** (p. 11), so a blood price
would cost him half of himself rather than the pool his card names. The
cost gates the option as well as being charged, the same way `bloodCost`
already did — a price the controller cannot meet is not a choice — and it
is paid at resolution, so a blocked burn is free.

## What the wave found

Nothing broken. What it confirms is that the `grantedAction` shape is now
carrying its weight: three cards, three different scopes, one new arm and
one new price field, and no engine change at all. The previous ally wave
needed a new mechanism per card; this one needed a seventh switch case.

The one thing worth recording for next time is about **tests, not the
engine**: a hand-written pass list pinned the wrong seat order, because
the impulse cycle after an announcement does not start at the acting
seat. The test now walks whatever the engine asks and asserts **which
seats were offered a block**, which is what "Ⓓ" actually means and is
immune to the cycle's starting point.

## Tests

`tests/cards/destroyer-allies.test.ts`, 5 tests. Two are negative space
and they are the point: The Bruisers cannot reach the predator's location
even with one sitting there, and Arcanum Investigator is offered nothing
at all when the only card in play is a location. Each has its positive
control in the same file.
