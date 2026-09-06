# The play-cost gate

Status: **design + implementation** (2026-08-31). Queue item 2 — the
deferral the discipline-filtered wave created (Libertas), and the gate
that retires the standing `.44 Magnum` equipment-cost deviation.

## 1. The problem

A card's cost was a **constant**: `spec.bloodCost` / `spec.poolCost`, read
directly at roughly a dozen affordability gates in the compiler and at two
payment sites in the engine. Nothing could change it.

A pool survey finds a real family that does:

| id | card | the cost clause |
|---|---|---|
| 100332 | Charisma | recruit ally actions cost this vampire **−1** blood or pool |
| 101100 | Libertas | cards requiring `[dom]` or `[pre]` cost **other** minions **+1** blood |
| 102288 | Consign to Oblivion | reaction cards cost **+1** blood or life |
| 102263 | Unleashing the Bestial Soul | the **next** reaction card costs **+1** blood or life |
| 102319 | Ensnare a Beast | strike cards cost the acting minion **+1** during the resulting combat |

Five cards built, one mechanism, three different scopes. That is a gate,
not a one-off. (Villein, 102121, is the sixth of the family and is
deferred — see §7.)

## 2. One shape, three homes

```ts
interface PlayCostMod {
  amount: number;                 // +1 / −1
  pays: "blood" | "pool" | "bloodOrLife" | "bloodOrPool";
  cardTypes?: PlayCostCardType[]; // "reaction" | "strike" | "ally" | …
  cardName?: string;              // Villein → "Minion Tap"
  requiresDiscipline?: string[];  // Libertas → ["dom", "pre"]
  minions?: "acting" | "others" | "bearer";
  once?: boolean;                 // Unleashing — the NEXT card only
}
```

Every filter present must match; absent filters do not constrain. The
three homes are the three scopes the cards actually use:

1. **`ActionFrame.playCostMods`** — for the duration of one action
   (Consign to Oblivion, Unleashing the Bestial Soul).
2. **`CombatFrame.playCostMods`** — for the duration of one combat
   (Ensnare a Beast, arriving through the existing `blockerCombatRider`
   path, since its clause is conditional on the blocker actually
   blocking).
3. **`PermanentStatics.playCostMod`** — radiated by a card in play
   (Charisma, Libertas, Villein), denormalized onto the entry the way
   `statics`/`aura`/`costSource` already are, so neither enumeration nor
   the kernel needs a registry lookup.

**`requiresDiscipline` is last wave's query.** `CardHandler.requiresDisciplines`
was built for "cannot be prevented by cards requiring Fortitude"; Libertas
needs exactly the same question asked at a different moment, so it is one
field of data rather than any new machinery.

## 3. The chokepoint

`playCostFor(state, handler, minion, opts) → { blood, pool }` in
derived.ts, beside `capacityOf` and `blockTollFor`. It starts from the
printed cost, applies every mod whose filters match, and **clamps at
zero** — a cost never goes negative.

It replaces the direct reads at both kinds of site, and **both kinds
matter**, the lesson `rescueDiscountFor` taught: at **enumeration**, or a
discount is unreachable in exactly the case it exists for and a surcharge
lets a minion announce something it cannot pay for; and at **payment**, or
the number on the table is a lie.

Two payment sites exist and both are covered: `playCard` (non-action
cards, paid on play, win or lose) and `resolveActionInner` (action cards,
paid at resolution, only on success, p. 27). The refund in
`cancelPendingCard` reads the same function, so a cancelled card returns
what it actually paid rather than what it printed.

### `once` is consumed at payment, not at enumeration

Unleashing the Bestial Soul's superior raises the cost of "the next
reaction card". Enumeration must be a pure read — it runs many times per
decision — so a `once` mod is *matched* freely and *removed* only when a
card actually pays it.

## 4. Readings on record

- **"blood or life"** (p. 22): allies hold life, not blood, and the
  `blood` field carries both behind a `kind` discriminant. The existing
  affordability gates already treat ally life as payable for a printed
  blood cost; this wave does not change that pre-existing simplification,
  it only records `pays` so the distinction is available when the
  withdrawal/ally pass wants it. `bloodOrLife` and `blood` therefore
  resolve identically today.
- **"−1 blood or pool"** (Charisma): the reduction lands on whichever
  resource the card actually charges, blood first when it charges both.
  No card in the V5 pool charges an ally both, so this is untested by
  construction rather than by choice.
- **Villein's self-clause** is per-vampire, not per-Methuselah: a second
  Villein costs +1 only on a vampire that already carries one.

## 5. What each card needed beyond the gate

- **Consign to Oblivion** superior: "those cards are not replaced until
  the end of the action". `ActionFrame.drawAfter` and the
  `delayedReplace: "afterAction"` path **already existed** — this is one
  condition beside the static handler flag, making the delay dynamic.
- **Unleashing the Bestial Soul** basic: "the chosen minion cannot play
  reaction cards this action" — `ActionFrame.noReactionsFrom`, read in
  the same place `canReact` is consulted for enumeration.
- **Ensnare a Beast** superior: the cost mod is conditional on the block
  succeeding, so it rides the existing `blockerCombatRiders` structure
  rather than being applied when the card is played.

## 6. What this retires

The frenzy gate deferred **Terror Frenzy superior** ("this combat, combat
cards cost the opposing vampire +1 blood") for want of exactly this: an
opposing-cost modifier (`docs/frenzy-design.md`). The card was marked
supported with only its BASIC mode implemented — the sort of gap no test
catches, because nothing asserts a mode that is not there. It is built
now, and needed two small pieces:

- **`PlayCostMod.minionId`** — a frame-scoped modifier naming exactly one
  payer. `minions: "bearer" | "others"` is relative to a card in play, and
  here there is no bearer.
- **`oncePerCombatAtSuperior`** — "a vampire can play only one Terror
  Frenzy at superior each combat" is a per-MODE limit, where
  `spec.combatLimit` is per card and would have wrongly restricted the
  basic mode too. It records `<name>:<mode>` in `playedThisCombat`,
  leaving the other mode free.

**Correction to an earlier draft of this doc:** it claimed the gate also
retired the `.44 Magnum` equipment deviation. It does not. That deviation
is about the bearer being unable to USE equipment
(`cf.restrict[side].equipment`), not about what a card costs. It stands.

## 7. Deferred: Villein (102121)

"Trifle. Put this card on a vampire you control who has any amount of
blood and move 2 to 5 blood from that vampire to your pool. Cards named
*Minion Tap* cost you +1 pool to play. **Villein costs +1 pool to play on
this vampire.**"

The first clause is routine and the second is one `cardName` mod away.
The third is not, and it is the interesting one: **the cost depends on a
choice made in the same option**. Villein is a master with no playing
minion, and "on this vampire" refers to its *attach target*, which is
picked as part of the play. `playCostFor` prices a card for a **payer**;
this needs it priced for a **target**, which is a different question and
changes the signature everywhere.

That extension is worth doing deliberately, with the other cards that
want it, rather than bolted on for one clause. Also missing and smaller:
a **seat scope** on `PlayCostMod` ("cost YOU +1 pool" — the controlling
Methuselah only, not the whole table). Nothing built this wave uses it, so
it is not built; the Minion Tap clause is what would need it.
