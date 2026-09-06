# Control vs Ownership, and Control Change — Design

Status: **IMPLEMENTED** (2026-08-03). Owner decided the scope question in
docs/granted-actions-design.md §6.2: **both tiers — cards in play and
minions.** Built: the state model (§3), all four consequences (§4), the
`steal` outcome (§6), and one card per tier — **Powerbase: Montreal**
(101439) and **Cave of Apples** (100311). Tests in
`tests/engine/control-change.test.ts` and `tests/cards/steal-cards.test.ts`.
§7 records the two judgement calls; §5 lists the cards this unblocks that
are still to build.

---

## 1. Rulebook facts (verified against the V5 PDF, p. 16 and p. 43)

Quoted, because this gate turns entirely on the exact wording.

**Control** (p. 16, Important Terms):

> Vampires put into play by a Methuselah are controlled by that
> Methuselah. A master card in play is controlled by the Methuselah who
> played it, **even if it is played on a card controlled by another
> Methuselah**. A minion card in play is controlled by the controller of
> the minion it is on. If a minion card is just in play and not on another
> controlled card, then it is controlled by the Methuselah who played it.
> **Control can change through game effects** and this is clearly noted
> when using those effects.

**Ownership** (p. 16, Rules of Card Ownership):

> The cards you start the game with are referred to as "owned". Your cards
> can become controlled by other Methuselahs but are **never owned** by
> them.

and (p. 16): "If you are ousted before the end of the game, any cards that
you own that other Methuselahs control remain in play until burned as
normal."

**Burn** (p. 16): a burned card "is placed into its **owner's** ash heap…
When a card is burned or removed from the game, any counters or other
cards on it are burned."

**Ousting** (p. 43, Ending the Game):

> If you are ousted, **all the cards you control are removed from the
> game**. Any of your rivals' cards you control are returned to them at
> the end of the game. Any of your cards controlled by other Methuselahs
> remain in play as normal.

## 2. What this exposes in the current model

1. **`MinionState` has `controller` but no `owner`.** Every "their owner's
   uncontrolled region" effect (Banishment, Pit of Contemplation) currently
   reads `controller`. Identical today; wrong the moment a vampire is
   stolen.
2. **`PermanentInPlay` records no controller at all** — it is inferred
   from which array the entry sits in. For an entry attached to a minion,
   `Engine.controllerOfEntry` answers "the minion's controller", which
   p. 16 says is **wrong for a master card** attached to another
   Methuselah's minion (Pentex™ Subversion, Haven Uncovered, Priority
   Contract). It is right for minion cards (equipment, retainers). This
   was flagged as an open question in the granted-actions doc; the
   rulebook answers it, so it becomes a fix here.
3. **The oust sweep clears `seat.minions` but not `seat.permanents`** —
   an ousted Methuselah's locations stay in play today. p. 43 says every
   card they control is removed from the game.

All three are pre-existing; control change makes them observable.

## 3. State model

```ts
// MinionState
/** Whose card this is (p. 16) — fixed for the game. Control may move to
 *  another Methuselah; ownership never does. */
owner: SeatId;

// PermanentInPlay
/** Who controls this card in play (p. 16): the Methuselah who played it,
 *  even when it sits on another Methuselah's minion. */
controller: SeatId;
owner: SeatId;
```

Control of a minion stays represented by **which seat's `minions` array**
holds it (plus `controller`); the arrays are what every rule about "minions
you control" already reads, so nothing downstream changes.

New event: `ControlChanged { target: "minion" | "permanent"; id; from; to }`.

New ops:

```ts
changeMinionControl(minion: MinionId, to: SeatId): void;
changePermanentControl(cardId: CardInstanceId, to: SeatId): void;
```

A stolen minion keeps everything — blood/life, counters, corruption,
attached cards, lock state, torpor — because none of that is keyed to the
controller. Cards attached to it follow it (p. 16: a minion card is
controlled by the controller of the minion it is on), except an attached
**master**, which keeps its own `controller`.

## 4. Consequences wired in this gate

- **Ousting**: `Ousted` removes every card the seat controls — its
  `minions` (already) **and** its `permanents` (the gap), which by
  definition includes any rival minions/cards it had stolen. A seat's own
  cards that others control live in *those* seats' arrays, so they stay in
  play automatically, exactly as p. 43 requires.
- **"Owner's uncontrolled region"**: Banishment and Pit of Contemplation
  switch from `controller` to `owner`.
- **`controllerOfEntry`** reads the recorded `controller` instead of
  inferring it, fixing masters on other Methuselahs' minions.
- **Ash heap**: still deferred (no region yet), but `owner` is now
  recorded, which is what that gate will need.

## 5. Cards this unblocks

| Card | Tier | Also needs |
| --- | --- | --- |
| **Powerbase: Montreal** (101439) | permanent | an influence-phase "add 1 blood to an uncontrolled vampire" latch |
| **The Rack** (101536) | permanent | an *on-control-change* hook ("as this location is played **or its controller changes**, its controller chooses a ready vampire they control") |
| **Fragment of the Book of Nod** (100785) | permanent | lock-to-draw-2 + discard down |
| **Powerbase: Los Angeles** (101435) | permanent | discard-phase actions (+1 discard phase action) — its own sub-system |
| **Cave of Apples** (100311) | **minion** | a granted Ⓓ action placing a corruption counter, and an ally's *cost* (see §7.2) |
| Saankaláxt (201786) "steal an equipment" | — | equipment-move between minions, a different deferred gate |

This pass builds the kernel plus one card per tier — **Powerbase:
Montreal** and **Cave of Apples** — so both halves of the owner's decision
are exercised end to end. The Rack, Fragment and Powerbase: LA follow.

## 6. Spec vocabulary

`permanent.vulnerableTo` gains `outcome: "burn" | "steal"` (default
`"burn"`), so "Vampires can steal this location as a Ⓓ action" compiles
from the same clause the burn family already uses — the action is directed
at the current controller, and success moves control to the acting
minion's controller.

## 7. Judgement calls (flagging rather than blocking)

1. **Stealing a card you already control a copy of.** Cross-player
   uniqueness contests are out of scope per CLAUDE.md, so the generator
   will happily let you steal a second copy of a unique location you
   already control. Consistent with the existing own-duplicate-only rule;
   noted as a deviation rather than special-cased here.
2. **An ally's "cost"** (Cave of Apples' threshold is "capacity or cost").
   `MinionState` records an ally's starting life in `capacity` and nothing
   about its pool cost, so I add `MinionState.cost` (set from the spec's
   pool cost when an ally enters play) and use `capacity` for vampires,
   `cost` for allies.
3. **Cave of Apples' "you can burn those counters to steal that minion"
   is optional, and is taken automatically** when the threshold is met —
   following the Dead Pool precedent for optional riders. Offering it as a
   real choice needs a decision point after action resolution; worth
   revisiting if the AI ever wants to decline (a stolen ally you must feed
   is the only case I can construct where declining is right).

## 8. Tests

Kernel: control moves a minion between seats with blood/counters/attached
cards/lock state intact; the new controller may act with it and the old
one may not; a seat's `Ousted` removes its permanents and any stolen
cards, while its own cards held by others stay in play; "owner's
uncontrolled region" sends a stolen vampire home to its **owner**, not its
controller; `controllerOfEntry` reports the placing Methuselah for a
master on another Methuselah's minion.
Cards: Powerbase: Montreal is stealable only as a directed action its
controller may block, and the thief gains its influence-phase ability;
Cave of Apples places corruption via a Ⓓ action and steals the minion only
once the counters reach capacity/cost, with the negative space asserted
(no steal below threshold, non-prey minions not offered, older vampires
not offered).
