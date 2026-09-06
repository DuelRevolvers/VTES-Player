# Counters that pay a card's cost

Status: **design + implementation** (2026-08-29). The next sub-system on
the counter-card ledger (`docs/one-off-sweep.md` §"remaining ledger"):
*"counters pay a card's blood/pool cost — Ravnos Carnival, Ravnos
Cache"*.

## 1. The two cards

**Ravnos Carnival** (101553, unique location, 1 pool)

> This location comes into play with 1 counter for each Ravnos you
> control. Ravnos you control can use those counters to pay some or all
> of the blood cost of action cards they play. If this location has no
> counters, burn it.

**Ravnos Cache** (101552, unique location)

> During your master phase, you can move 1 counter from your pool to this
> location and add 1 counter (from the blood bank) to it. Minions you
> control can lock this location to use those counters to pay some or all
> of the blood or pool cost of equipment they equip.

Between them they cover every axis the mechanic has: blood vs pool, a
clan filter vs none, a lock as the price of use vs free use, and a
burn-when-empty rule vs none.

## 2. The rules question: when is the split chosen?

A card's cost is paid **at resolution, only on success** (p. 27) — the
engine already does this for action cards and equipment. But *how* it is
paid ("some or all") is a decision, and the project rule is that a card's
optional riders are never auto-taken (two such deviations were retired
during the choice-frames work).

Two candidate shapes:

1. **Decide at announcement**, carried on the action frame and applied at
   resolution. Enumerated as extra play options — one per affordable
   split.
2. **Decide at resolution**, as a ChoiceFrame.

**Decision: (1).** It matches how every other "choose X" cost in the
engine already works — Oxford University's "lock and burn X pool for +2X
votes" enumerates over affordable X, `moveOwnVampireBloodToPool`
enumerates x = 1…blood — and it keeps the legal-move generator honest:
the whole decision is visible in the option list at the one point where
the player is being asked anything. (2) would also collide with the
documented hazard that a choice raised inside `resolveAction` is popped
by the action's own `pop()`.

The cost is still *paid* at resolution, so a blocked action spends no
counters and does not lock the Cache — the announced split is only an
instruction for the payment that may never happen.

## 3. Spec + state

`permanent.costSource`, denormalized onto the card in play at entry the
way `statics` and `aura` already are, so neither the option enumeration
nor the kernel needs a registry lookup:

```ts
costSource?: {
  pays: Array<"blood" | "pool">;
  /** Which cards it may pay for, by card type. */
  for: "action" | "equipment";
  /** "Ravnos you control can use those counters…" */
  clan?: string;
  /** "…can lock this location to use those counters" — spending locks
   *  it, and it must be unlocked to be used at all. */
  locks?: boolean;
  /** "If this location has no counters, burn it." */
  burnWhenEmpty?: boolean;
};
```

`"action"` means card type Action specifically, not "anything played as
an action": equipment, allies, retainers and political actions are their
own card types, so Ravnos Carnival does not pay for them. This falls out
of matching on `CardSpec.cardType` at the compiler site.

`ActionFrame.costFromCards: Array<{ cardId; blood; pool }>` records the
announced split.

## 4. Where it plugs in

**Option enumeration** (compile.ts). The affordability gates already read
`m.blood < spec.bloodCost` and `seat.pool < poolCost`; a cost source
widens them, so this cannot be a pure post-processing wrapper — a vampire
with 0 blood *can* equip a 1-blood weapon off the Cache, and the base
enumeration would never offer it. One shared helper, `paymentSplits`,
returns every split (always including "pay it all yourself"), and the two
compilers that gate on cost — `compileActionCard` and `compileEquipment`
— loop over it and keep the affordable ones. Master, ally, retainer and
political-action costs are untouched: no card in the V5 pool pays those
from counters.

The split rides in the play option's params as
`payFrom: "<cardId>/<blood>/<pool>"`, so it lands in the option id
through the existing param convention:
`play:<Name>:<mode>:<minion>:pay=<cardId>/<b>/<p>:<cardInstanceId>`.
Prefix-matching traces are unaffected because the plain "pay it yourself"
option is generated first.

**Payment** (engine.ts). `announceCardAction` parses `payFrom` onto
`af.costFromCards`; `resolveActionInner` spends the counters, subtracts
them from what the minion and seat owe, locks the source if its
`costSource.locks`, and burns it if `burnWhenEmpty` left it empty. The
counters are re-checked at resolution and the spend clamps to what is
actually there, so a source that lost its counters in between just pays
less and the rest comes out of blood/pool as normal.

## 5. Card notes

- **Ravnos Carnival** enters with one counter per Ravnos its player
  controls — which is **zero** if they control none, and "if this
  location has no counters, burn it" then burns it on arrival. That is
  what the card says, and the pool is spent either way; the engine plays
  it straight.
- **Ravnos Cache**'s master-phase ability costs 1 pool and adds **two**
  counters (one moved from the pool, one from the blood bank). It is a
  card ability, not a master phase action, so it does not spend the
  phase's action — the usual `usedThisPhase` latch (p. 16) limits it to
  once per phase. It is gated on `ctx.turnSeat` as well as `ctx.seat`,
  per the 2026-08-02 "during your X phase" bug.

## 6. What widening the fuzz decks found

Adding these two cards to the fuzz deck list exposed that the list was
never being used: each seat's library was built as
`for (k = 0; k < 15; k++) deckNames[k % deckNames.length]`, so only the
**first 15** of 174 listed names ever entered a game. Every card appended
since the early sweeps was decorative — including every card from the
gates that landed this month. Building the decks from the whole list
broke two invariants immediately, both now fixed, with regressions in
`tests/engine/fuzz-regressions.test.ts`:

1. **Ballot restrictions escaped the polling window.** The modifier
   compiler skipped `modifyVotes` modes outside `referendum.polling` but
   not `restrictVotes`, so Closed Session and Private Audience were
   offered as plain action modifiers during any action, and resolving one
   there threw "restrictReferendumVotes outside a referendum". Four of
   ten seeds hit it.
2. **A mandatory choice with no legal answer stranded the loop.** The Rack
   asks its controller to choose a ready vampire; a Methuselah with none
   got a ChoiceFrame with an empty option list that nothing popped, and
   the engine then offered a decision with zero options — the harness's
   first invariant. An optional choice always carries its Decline, so
   only a mandatory one could do this; `settle` now pops such a frame,
   which is what the choice-frames design already claimed happened.

## 7. Deviations recorded

- "If this location has no counters, burn it" is checked when counters
  are spent and when the card enters play. Nothing else in the pool
  removes counters from it, so there is no third path today.
- Only Action and Equipment costs can be paid from counters. If a later
  card pays a master's pool cost or an ally's, the helper is already
  written — it is the gate sites that would need the same two lines.
