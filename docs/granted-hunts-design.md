# Granted hunts — Week of Nightmares' steal

Designed 2026-10-29. **Status: BUILT (0.11.57).** The owner answered both
§4 questions with the recommendation on 2026-10-29: the steal is a hungry
Ravnos's mandatory hunt, a Ravnos with no hunt it can make is stuck, and a
steal from a rival's Ravnos is directed at that rival (p. 25). §7 records
what the build changed from this design.

Week of Nightmares (102166) prints a hunt action, and the engine announces it
as an ordinary card action. When the card was built, that difference was
invisible: `bespoke-economies-design.md` §5 records it as a deviation
because "no card in the V5 pool" read hunt actions. The legacy library has
since admitted Restricted Vitae and Psychophagia, and `hunt-success-design.md`
built one payout funnel for every hunt. Reading the card against the code
today finds eight defects (§2), three of which change what a player is
offered.

## 1. Printed text and rulings

> Only one Week of Nightmares can be played in a game. Put this card in play
> with 10 nightmare counters. Ravnos get +1 bleed and +1 strength and do not
> hunt as normal. Any Ravnos can steal 1 blood from another Ravnos as a +1
> stealth hunt action. […]

The card's rulings, from `data/vtes-raw.json`:

1. A minion can perform the special hunt once per turn
   [RBK action-card-or-card-in-play].
2. Other non-standard hunt actions are still permitted, and Week of
   Nightmares doesn't combine with them [LSJ 20090606] [ANK 20190707]
   [LSJ 20060306].
3. The steal can't take more blood than the target has. It **can target a
   vampire with no blood**. If no blood is stolen, the hunt is unsuccessful,
   though the action stays successful [LSJ 20050720-2] [RTR 20010711]
   [LSJ 20100915].
4. Stolen blood the hunter can't hold goes to the blood bank
   [LSJ 20010809-1].
5. The steal must be directed at a vampire. It can't be performed if there
   are no other vampires [LSJ 19970224].
6. **Hunt value applies.** All the blood gained is taken from the target
   [RTR 20180511] [RTR 20030519].
7. The action requires a Ravnos [LSJ 20080604].

Restricted Vitae (an event, in the pool) prints: "Do not replace until a
vampire successfully hunts. Vampires cannot hunt unless they must hunt.
Vampires who must hunt can steal 1 blood from a younger vampire as a Ⓓ hunt
action."

The rulebook:

- **p. 19:** a ready vampire with no blood must hunt as a mandatory action.
  A minion with "one mandatory action they cannot take" is **stuck** and
  "cannot perform any action (this does not prevent your other minions from
  performing actions, however)."
- **p. 21:** none of your minions can perform a non-mandatory action while
  any of your ready unlocked vampires still owe a hunt.
- **p. 25:** an action that "targets one or more other Methuselahs or things
  controlled by other Methuselahs" is directed. The Ⓓ symbol is only a
  reminder (p. 19), so a card without it can still be directed.

## 2. What the engine does today

The steal is `weekOfNightmares.actionOptions` in `cards.ts`. It announces a
`cardEffect` through `announceEntryAction`, with no target minion, and its
`resolveGrantedAction` moves exactly 1 blood by hand.

| # | Defect | Rule | What a player sees |
|---|---|---|---|
| D1 | A Ravnos with **no blood** is offered the **basic hunt**. The mandatory-hunt branch of `minionPhaseOptions` never asks `auraBlocksHunt`; only the ordinary branch does. | card text | A hunt the card forbids |
| D2 | That Ravnos is **never offered the steal**. The mandatory branch offers basic hunts, Restricted Vitae's steal and hunt action cards, but no granted hunt. | p. 19, ruling 2 | The card's own hunt is missing |
| D3 | **Restricted Vitae doesn't bar the steal.** Its filter covers hunt action cards only. | Restricted Vitae | A Ravnos with blood can steal |
| D4 | A successful steal **isn't a successful hunt**: no `onHuntSuccess`, no Hospital Food, no Restricted Vitae replacement, and Thirst's "did not hunt" doesn't see it. | p. 21, ruling 3 | Restricted Vitae never leaves |
| D5 | **Hunt value is ignored.** It steals exactly 1. | ruling 6 | "+1 hunt" does nothing |
| D6 | A Ravnos with **no blood can't be a target**. | rulings 3, 5 | Too few targets |
| D7 | The steal is **always undirected**, even from a rival's Ravnos. | p. 25 | The wrong seats may block |
| D8 | Fixing D1 creates a **stuck** Ravnos (no way to hunt), and the mandatory branch returns early, so it would hold back every other minion. | p. 19 | Nothing to do but end the turn |

D1 is the drift lesson in CLAUDE.md ("one question asked in two places will
drift"): the two hunt branches spell the same rule, and only one learned the
aura.

Already right, and kept:

- The steal is once per turn per minion. `grantedActionUses` resets at
  `TurnBegan` (ruling 1).
- Hunt action cards such as Psychophagia, and Restricted Vitae's steal, are
  still offered to a Ravnos (ruling 2). The aura blocks the basic hunt only.
- The action requires a Ravnos, since 0.11.54 (ruling 7).
- Festivo dello Estinto can't reach the steal. It names Sabbat vampires, and
  all 13 Ravnos in the crypt are Anarch.

## 3. Design

No new primitive. Every piece already exists for another card.

1. **Announce the steal as a hunt.** Week of Nightmares calls
   `announceEntryAction` with `actionKind: "hunt"` and `targetMinion: victim`.
   The type already allows `"hunt"`, and the 0.11.55 toll code already
   handles it, but no grant has used it. The target makes directedness derive the p. 25 way that the
   function already does (D7). `announceEntryAction` gains one line, the
   built-in path's `huntedThisPhase` stamp (D4, Thirst).
2. **Pay it through `payHunt`.** Action resolution already calls
   `payHunt(af, 1)` for a hunt with no card. That one funnel caps the steal at
   the target's blood, adds hunt value, drains the excess, and fires the
   success triggers and Restricted Vitae's release (D4, D5). Week of
   Nightmares' `resolveGrantedAction` stops moving blood, or the victim would
   pay twice.
3. **Mark the option.** A `useEntryAction` option gains `huntAction?: true`,
   the `entersCombat` precedent beside it. Three readers ask it:
   - The toll gate passes `"hunt"` instead of `"other"`.
   - Restricted Vitae's filter removes a marked option unless the minion must
     hunt (D3).
   - The mandatory branch offers a hungry minion's marked options (D2).
4. **Widen the targets.** Any other Ravnos, including one with no blood (D6).
   A steal from an empty Ravnos is a successful action and an unsuccessful
   hunt, which `payHunt` already returns early on.
5. **Ask the aura in the mandatory branch.** The basic `hunt:` option there
   checks `auraBlocksHunt`, the same as the ordinary branch (D1).
6. **Generalise "stuck".** In `minionPhaseOptions`, a hungry vampire whose
   hunt options come out empty is stuck (p. 19). If some hungry vampire can
   hunt, only those hunts are offered, as now. If none can, enumeration falls
   through to the ordinary branch with the stuck vampires removed: no basic
   action, no action card, no granted action (D8).

   `canAct` keeps its Change of Target case. Card enumerators call `canAct`
   directly, and the new check covers only what `minionPhaseOptions` returns.
   Both answer one rule, so the new helper's comment names the other.

## 4. Questions for the owner

1. **Does the steal make a Ravnos's mandatory hunt?** Under Week of
   Nightmares, a Ravnos with no blood still must hunt (p. 19) and can't hunt
   as normal. I read the steal as that hunt, because it is "a hunt action" and
   ruling 2 permits non-standard hunts. Then a Ravnos with no other way to
   hunt is stuck (p. 19): it does nothing that turn, and your other minions
   act as usual. **Recommendation: yes to both.** Today it takes a normal hunt
   the card forbids.
2. **Is the steal directed when it targets a rival's Ravnos?** The card has no
   Ⓓ, and today the steal is always undirected, so your prey or predator may
   block it. By p. 25 a steal from another Methuselah's Ravnos is directed at
   that Methuselah, and only their minions may block. A steal from your own
   Ravnos stays undirected. **Recommendation: follow p. 25.** Restricted
   Vitae's steal already works this way.

The rest of §3 follows from a printed ruling and needs no answer: targeting a
Ravnos with no blood (ruling 3), hunt value (ruling 6), and Restricted
Vitae's bar (its own text).

## 5. Tests

A new `tests/cards/granted-hunts.test.ts`, every case with a negative-space
twin:

- A Ravnos with no blood is offered the steal and **not** the basic hunt.
  While it owes the hunt, its controller's other minions are offered nothing.
- A stuck Ravnos (no other Ravnos in play, no hunt card) is offered nothing,
  and the same seat's other minions can bleed. Control: add a second Ravnos
  and the steal returns.
- A steal from a Ravnos with no blood succeeds as an action and gains no
  blood. Restricted Vitae stays.
- With "+1 hunt", the steal takes 2, or 1 from a target holding 1. The victim
  loses exactly what the hunter gains, never twice.
- Restricted Vitae in play: a Ravnos with blood isn't offered the steal. A
  Ravnos with no blood is offered both steals. A successful Week of
  Nightmares steal releases Restricted Vitae's replacement.
- A steal from a rival's Ravnos is directed: only that rival is asked to
  block. A steal from your own Ravnos is undirected: prey and predator are
  asked.
- Thirst's "did not hunt" sees the steal.
- Psychophagia stays playable under Week of Nightmares (ruling 2).
- The once-per-turn limit still holds.

The fuzz decks already hold Week of Nightmares. The run is checked for a
change in offered hunts, per the CLAUDE.md lesson that a card in the fuzz is
not a card it plays.

## 6. Docs to update when built

- `bespoke-economies-design.md` §5: replace the hunt deviation line with a
  pointer here.
- `CLAUDE.md`: the green baseline, and this doc in the index under
  "Actions and blocking".

## 7. As built (0.11.57)

§3 was built as written, in `engine.ts` (`minionPhaseOptions`,
`announceEntryAction`, the toll gate, and a new `stuckActs`), `options.ts`
(`huntAction` on `useEntryAction`) and `weekOfNightmares` in `cards.ts`.
What differs, or was found while building:

- **D9, found while building: the steal ignored Secure Haven.** Once the
  steal names its victim, "cannot be the target of other Methuselahs'
  actions" reaches it, so the enumerator asks `untargetableBy`. This is
  the same gap 0.11.55 closed in `permanentRushGrant`.
- **The stuck filter covers actions only.** `stuckActs` removes a stuck
  vampire's basic actions, action cards and granted actions. An in-play
  ability isn't an action (p. 19 says "cannot perform any action"), so it
  stays. The mandatory-bleed branch (Elen Kamjian) also skips a stuck
  vampire, because it returns before the final filter.
- **Ruling 2 is tested with Restricted Vitae's steal, not Psychophagia.**
  Psychophagia requires a Hecata, so no Ravnos can play it. A hungry Ravnos
  under both cards is offered both steals and no basic hunt.
- **Tests:** 11 in `tests/cards/granted-hunts.test.ts`. Against the old
  engine, 9 fail. The 2 that pass pin behaviour that was already right:
  the once-per-turn limit, and a steal from your own Ravnos being
  undirected.
- **Soak:** `npm run simulate -- --games 200 --seed 7` gave 0 errors,
  because the stuck rule runs in every minion phase of every game.
