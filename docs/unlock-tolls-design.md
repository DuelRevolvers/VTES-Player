# Unlock-phase tolls, and the Ⓓ-burn retrofits

*The Gate of Acheron (102290), Smiling Jack, The Anarch (101811),
Constant Revolution (100416), Powerbase: Madrid (101437), Wasserschloss
Anif, Austria (102152).*

**This wave pays down the ledger rather than opening a family.** Four of
its five cards are already marked supported and carry a row in
`docs/partial-support.md`; the fifth is a cut row unblocked by the ash
heap. One card is newly supported, six ledger rows are retired, and the
mechanism that retires four of them is the one the fifth needs anyway.

## 1. The cluster, and why it is one

Three cards in the pool print the same sentence with a different second
currency:

| Card | Printed |
|---|---|
| **Smiling Jack** | "During each other Methuselah's unlock phase, for each counter on this card, that Methuselah burns 1 pool **or burns 1 blood from a vampire they control**." |
| **Constant Revolution** | "During each other Methuselah's unlock phase, that Methuselah burns X pool **and/or cards at random from their hand**, where X is the number of counters on this card." |
| **The Gate of Acheron** | "During your prey's unlock phase, for each counter on this card, they burn 1 pool **or remove a library card at random in their ash heap from the game**." |

All three are **one toll of X units, each unit paid one of two ways, by
the Methuselah whose unlock phase it is** — and for once that is not a
reading. The rulebook rules Smiling Jack by name (p. 50), and settles
every question the mechanism raises:

> **Smiling Jack, The Anarch.** "If you control Smiling Jack, The Anarch
> during your unlock phase, you have to move 1 pool to the card **even if
> it ousts you**. Each other Methuselah must burn 1 pool **or a vampire
> blood** for each counter on Jack, and **it is possible to do a mix
> between multiple vampires and the pool**. **Failing to burn 1 blood
> from an empty vampire will not lessen the obligation.**"

Four things, all of which the design below inherits: the accumulator is
**mandatory** and is not gated on being able to afford it; the toll is
**per unit**, not per card; the units **mix freely** across payers, which
is why it is a repeated one-unit question rather than a split; and an
**empty vampire is not a way out** — a vampire with no blood is not a
legal way to pay, and the unit still has to come from somewhere.

**It also finds a live bug.** Smiling Jack's accumulator was written
`if (pool >= 1)`, so a Methuselah on their last pool quietly stopped
feeding the card. "Even if it ousts you" says otherwise, and the guard is
gone. Two of them were shipped with
the alternative hand-waved — the ledger's rows read "the 'or 1 blood'
alternative" and "the 'and/or cards at random' alternative" — because
there was nowhere to ask the victim a question. `choiceByKey` and the
repeated-frame shape (Shroud of Decay's `targetDiscard`) are that place.

The other two cards join the wave for the second clause they all share.

## 2. `permanent.unlockToll`

```ts
unlockToll?: {
  /** Whose unlock phase pays: every other Methuselah, or just the prey. */
  whose: "others" | "prey";
  /** The second way to pay one unit. Pool is always the first. */
  alternative: "blood" | "randomDiscard" | "removeAshHeapCard";
};
```

Wired in **`compileSpec`, not in one compiler** — Smiling Jack and
Powerbase: Madrid are Masters, Constant Revolution and The Gate of
Acheron are Actions. That is the `pool-drain-design.md` precedent, and
the same reason applies: the mechanism crosses card types.

### It is a ChoiceFrame, addressed to the payer

The toll is raised from `onAnyUnlock`, which fires inside the unlock
sweep — not inside action resolution — so `raiseChoice` pushes the frame
immediately rather than queueing it.

**One frame at a time, re-raised, not X frames pushed at once.** The
`targetDiscard` shape: `params.left` carries the remaining count, `apply`
pays one unit and re-raises while `left > 1`. Pushing X frames up front
would compute every option list against a board state that the first
answer has already changed — the payer's pool falls, a vampire runs out
of blood, the ash heap empties.

**Non-optional.** "That Methuselah burns…" is not an offer. The payer
chooses *how*, never *whether* — the same reading Shroud of Decay takes,
and the library-search lesson applies with force: an optional frame's
decline is a plain `pass`, which pops the frame **without calling
`applyChoice`**, so an optional toll would be a toll nobody ever pays.

**Pool is always offered.** A payer with no pool is a payer about to be
ousted; burning pool they do not have is the ordinary oust path, not an
illegal option. The alternative is offered only when it can actually be
paid — no vampire with blood, an empty hand, an empty ash heap — and with
neither available the pool option is the whole list, which is correct
rather than a dead end.

### Randomness goes through the engine

"Cards at random" and "a library card at random" are the first card
effects to need a die roll. **`EngineOps.randomIndex(n)`** is the whole
addition: principle 2 says all randomness flows through the seeded RNG,
and the ops surface is the card→engine boundary, so a card never touches
`state.rngState`. Replay is unaffected — `applyChoice` runs in a replay
exactly as it ran the first time, and `rngState` advances identically.

**Reading on record: "a library card … in their ash heap" is every card
in the heap today.** Burnt vampires are deliberately not modelled in the
zone (`ash-heap-design.md` §2), so there is nothing there that is not a
library card. The filter is written as the card prints it and correctly
selects everything.

**Citation on record: a burnt hand card IS replaced.** p. 7 — "Whenever
an effect changes your hand size or **adds or removes cards from your
hand, immediately discard down to or draw up to match your hand size**."
So Constant Revolution's unit passes `replace: true`, and the punishment
it deals is card quality and library depth, not hand size. This is the
opposite of Shroud of Decay's forced discard-down, which is a hand-size
reduction and passes `false`; the two look alike and are not.

## 3. `permanent.unlockCounter`

"During your unlock phase, add 1 counter to this card" — printed
identically by The Gate of Acheron and Constant Revolution, where it was
a hand-rolled `onControllerUnlock`. One field, fired from the same hook.

Deliberately **not** generalised to cover Powerbase: Madrid's version,
which is optional and capped ("if this card has 3 or fewer counters …
you **can** add 1 counter"). That is a different clause wearing similar
words, and it already works.

## 4. `permanent.counterGrant`

"Hecata you control with capacity 4 or more can add 1 counter to this
card as a +1 stealth action" (The Gate of Acheron) is
`Pit of Contemplation`'s second clause with a capacity filter, and Pit of
Contemplation hand-rolled it. It becomes data:

```ts
counterGrant?: {
  who: { kind?: "vampire"; clan?: string; sect?: Sect; minCapacity?: number };
  amount: number;
  stealth?: number;
};
```

It joins the granted-action providers and dispatches on the **`:counter:`**
verb segment — the same segment Pit of Contemplation's bespoke option id
already uses, chosen so the two spell the mechanic the same way.

**Pit of Contemplation is deliberately NOT retired onto it.** It is
supported and green; rewriting a working card onto a new flag is a
separate, checkable change (the Platinum Protocol precedent). Recorded in
`partial-support.md` as a retrofit, not left to be re-derived.

## 5. `vulnerableTo.outcome: "burnCounters"`

Four ledger rows are the same deviation: **"minions can burn this card as
a Ⓓ action"**, hand-waved on four bespoke counter cards before
`permanent.vulnerableTo` generalised it. The granted-actions gate
reversed that deviation by owner decision, so all four are a data change.

Three of them need nothing new:

| Card | Printed | Spec |
|---|---|---|
| **Smiling Jack** | "Vampires can burn this card as a Ⓓ action." | `who: { kind: "vampire" }` |
| **Constant Revolution** | "…as a Ⓓ action that costs 1 pool." | `who: { kind: "vampire" }, cost: { pool: 1 }` |
| **Wasserschloss Anif** | "Any minion can burn this card as a Ⓓ action; **Malkavians get +1 stealth** during that action." | `who: {}`, `stealthFor: [{ clan: "Malkavian", delta: 1 }]` |

The fourth needs one new outcome. Powerbase: Madrid prints "Vampires
controlled by other Methuselahs can **burn all the counters from** this
card as a Ⓓ action" — the card survives, its counters do not, which is
neither `burn` nor `steal` nor `shuffleIntoLibrary`. `outcome:
"burnCounters"` is the fourth member, resolved by `removeCounters`.

**Negative space worth pinning:** a card with no counters left is still a
legal target of that action (the card says nothing about counters being
present), and taking it against an empty Powerbase does nothing. That is
the option list being permissive for the *printed* reason, which is the
opposite of the Priority Contract trap — so it gets a test rather than a
guard.

### Three of the four are hand-rolled handlers with no spec

Smiling Jack, Wasserschloss Anif and Powerbase: Madrid are bespoke, so
they are not compiled through `compileSpec` and cannot pick a provider up
from a spec clause. Each takes `vulnerableGrant(...)` spread onto it from
a **local spec literal** naming only the clause — the minimum that makes
the retrofit a data change rather than a rewrite of three working cards.

Constant Revolution already builds on `compileSpec(specByName(…))`, so it
gains its clause by having a `permanent` block at all — which is also
where its `unlockToll` and `unlockCounter` go, and how three of its four
printed clauses stop being bespoke.

## 6. The Gate of Acheron, clause by clause

```
+1 stealth action. Unique.
Put this card in play with 1 counter.
During your unlock phase, add 1 counter to this card.
During your prey's unlock phase, for each counter on this card, they burn
  1 pool or remove a library card at random in their ash heap from the game.
Hecata you control with capacity 4 or more can add 1 counter to this card
  as a +1 stealth action.
Vampires can burn this card as a Ⓓ action.
```

| Clause | Mechanism |
|---|---|
| +1 stealth action, unique | `actionStealth`, `unique` |
| put in play with 1 counter | `putInPlayOnSuccess { counters: 1 }` |
| +1 counter each of your unlock phases | `permanent.unlockCounter` (§3) |
| the prey's per-counter toll | `permanent.unlockToll` (§2) |
| the Hecata counter action | `permanent.counterGrant` (§4) |
| vampires can burn it | `permanent.vulnerableTo` (§5) |

**Every clause is data.** The card needs no bespoke handler, which is the
argument for §3 and §4 existing at all: two of them were one-card
mechanisms until this card printed them again.

**Ordering that matters:** the toll fires from `onAnyUnlock`, the counter
from `onControllerUnlock`, and the engine runs every seat's
`onControllerUnlock` **before** `onAnyUnlock` in the same sweep. So on
the controller's own turn the counter lands first and the toll does not
fire (the controller is not their own prey); on the prey's turn the toll
reads the count as it stood at the end of the controller's turn, which is
what "for each counter on this card" means when the card is read on the
prey's phase.

## 7. What this wave does NOT do

Two ledger rows on these cards are deliberately left standing, because
neither is what the row said:

- **Nothing here touches `Powerbase: Madrid`'s vote clause** or
  Wasserschloss's blood pump. Both work; only the Ⓓ-burn row is retired.
- **Pit of Contemplation stays bespoke** (§4).

Both are recorded in `partial-support.md` under retrofits, so the next
survey does not re-derive them.
