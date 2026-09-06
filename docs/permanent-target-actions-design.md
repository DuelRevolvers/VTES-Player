# Actions that target a card in play

Status: **design + implementation** (2026-08-30). Chosen by pool survey
after the gate queue emptied; the cluster the bleed sweep pointed at.

## 1. The shape

"Ⓓ Burn a location", "Ⓓ Burn an equipment", "Ⓓ Steal a location" — an
action card played **from hand** whose target is not a Methuselah and not
a minion but a **card in play**.

Half of this already existed. `ActionFrame.targetPermanent` and the rule
that such an action is **directed at the card's controller, who alone may
block** (p. 25) were built for *granted* actions —
`announceEntryAction` has taken a `targetPermanent` since the
granted-actions gate. What was missing was the path from a hand card:
`announceCardAction` hard-coded `targetPermanent: null`.

So the work is one field threaded through, one primitive, and one target
enumerator:

- **`CardActionParams.targetPermanent`**, with the same directedness rule
  as the granted path — read the controller, aim at them.
- **`actionOnPermanent { what, outcome, poolFromController? }`** —
  `what` picks the zone (locations sit at seat level, equipment on
  minions), `outcome` is burn or steal (`changePermanentControl`, from the
  control-change gate), and `poolFromController` is Rewilding's extra.
- **`enumeratePermanentTargets`** — one option per legal card, fixed at
  announcement (p. 25), so the choice rides in the option id.

**Ordering that matters:** Rewilding reads the controller **before** the
burn. Once the card is gone `controllerOfEntry` has nobody to return, and
"burn 2 pool from its controller" would silently do nothing.

`controllerOfEntry` moved from private to the `EngineOps` interface — a
card effect aiming at a permanent needs it, and it is a pure read.

## 2. Cards

| id | card | |
|---|---|---|
| 100391 | Conceal | `[obf]` burn an equipment · `[OBF]` burn a location |
| 101632 | Rewilding | burn a location **and** burn 2 pool from its controller |
| 100573 | Dominate Kine | `[dom]` bleed +1 at +1 stealth · `[DOM]` **steal** a location |
| 101324 | Open War | four clauses — below |

## 3. Open War

Four clauses, three of them offered to **every** Methuselah, which is what
makes it the interesting one:

1. **"Only one Open War can be played in a game."** No new state: the
   event log is the record of everything ever played
   (`CardPlayed` with that name), the Week of Nightmares precedent. This is
   stricter than "only one in play" — a second copy stays unplayable after
   the first burns, which is what "in a game" means.
2. **"Anarchs can enter combat with a minion as a Ⓓ action."** Pure spec:
   `permanent.rushGrant` with `who.scope: "any"` and `sect: "anarch"`, so
   it reaches Anarchs belonging to Methuselahs who do **not** control the
   card.
3. **"Anarchs can burn a location as a Ⓓ action that costs 2 pool."** A
   granted action targeting a card in play — `announceEntryAction` with
   `targetPermanent` and `cost.pool`. One card now grants **two**
   different actions; the compiler's granted-action merge dispatches on
   the verb segment of the option id (`:rush:` vs `:raze:`).
4. **"Methuselahs can use a master phase action to move 1 counter from
   their pool to this card. If this card has 4 counters, burn it and gain
   4 pool."** `abilityAnySeat` (built for Week of Nightmares) makes the
   ability visible to every seat, gated on it being that seat's own master
   phase.

### The payout — an owner ruling

The card does not name who gains the 4 pool. Two readings:

- **the Methuselah who places the fourth counter** — the subject carries
  from the preceding sentence, making it a pot: everyone feeds it and
  whoever completes it takes 4;
- **the card's controller** — the Methuselah who played Open War.

**The owner ruled (2026-08-30) for the controller.** So the card is a
self-funding engine for its player: rivals may feed it (they get the
Anarch actions in exchange) but the payout comes home. Implemented as
`entry.controller`, which also means it follows the card if control ever
moves.

## 4. Deferred: Stolen Police Cruiser (101872)

It belongs to this family only by its `vulnerableTo` clause ("Vampires can
burn this card as a Ⓓ action that costs 1 pool"), which is already data.
What blocks it is a different clause: **"Allies and younger vampires get
−1 intercept against this Anarch"** — a *persistent* intercept penalty
keyed on the blocker's kind and capacity, applying to every action the
bearer takes. `modifyAllIntercept` is action-scoped and the aura system
has no intercept field, so this wants a derived static of its own. Its
third clause ("does not unlock as normal during their next unlock phase")
needs nothing new — `MinionState.skipNextUnlock` was built for On the Qui
Vive and is waiting.
