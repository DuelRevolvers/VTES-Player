# Blood-banking locations — the five Powerbases (wave 58)

*2026-09-16, platform v0.10.49. Library 697 → 702.*

**Cards:** Powerbase: Barranquilla (101431), Powerbase: Chicago (101434),
Powerbase: Mexico City (101438), Powerbase: New York (101440),
Powerbase: Washington, D.C. (101444).

## §1 The family

Five unique locations whose printed text is one shape said five ways:

> blood sits **on the card**, the controller draws it down a little at a
> time, and a minion of **another Methuselah** can take the whole pile as
> a Ⓓ action.

They differ only in the four dials that make the wave worth asserting
against itself:

| | store starts at | the controller's offer | window | raid | empty ⇒ burn |
|---|---|---|---|---|---|
| **Chicago** | 0 | +1 from the bank, **or** all of it to pool | unlock | any other Methuselah's vampire, takes the blood | no |
| **Mexico City** | 5 | 1 to pool — **no "may"** | unlock | Sabbat only, takes the blood | yes |
| **Washington, D.C.** | 0 | up to 3 pool in, matched from the bank; **or** 2 out | unlock | any other Methuselah's vampire, takes the blood | no |
| **New York** | 0 | 1 pool buys 3 from the bank; **or** 1 out | master, **spends the master action** | Sabbat only, takes the blood | yes |
| **Barranquilla** | capacity of a ready Sabbat you control | 1 to pool | unlock | any vampire **BURNS** it; titled get +1 stealth | yes |

Barranquilla is the odd one: its counter-play destroys the card rather
than taking the blood, which is exactly why banking a 10-cap vampire's
worth of counters onto it is safe, and why it is the one card here whose
raid is the plain `vulnerableTo` burn already in the vocabulary.

## §2 `permanent.bloodStore`

One spec block pays for all five (`spec.ts`, beside `unlockCounter`):

```ts
bloodStore?: {
  start?: number | { capacityOfReady: { sect?: Sect; clan?: string } };
  offers?: BloodStoreOffer[];
  unlockToPool?: number;      // the mandatory drip
  burnWhenEmpty?: boolean;
};
```

`BloodStoreOffer` names the **window** rather than the card building its
own option, because the window IS the difference between Chicago and New
York. Three kinds: `bankToCard`, `cardToPool` (a number or `"all"`) and
`poolToCardMatched` (Washington's "move up to N pool and add 1 blood from
the bank for each").

The store is `PermanentInPlay.counters` — the **Wasserschloss Anif
precedent**. A blood on a card and a counter on a card are the same
physical counter (p. 5); nothing downstream needs to tell them apart, and
the raid reads the same field the `burnCounters` outcome already did.

**One latch for the whole offer set.** "During X, do Y" is once per phase
(p. 16), and each card's offers are an EITHER/OR — Chicago banks a blood
*or* cashes the pile, never both — so `entry.phaseUses` gates the set, not
each offer. A per-offer latch would have let Washington invest and cash
out in the same unlock phase.

**Futile options are not offered.** `cardToPool` on an empty card is not
enumerated: it would spend the phase's one use for nothing
(`docs/futile-options-design.md`). `poolToCardMatched` stops one short of
the controller's pool, because an optional effect that ousts you is never
a move (p. 6).

## §3 `burnWhenEmpty` is ONE rule, checked on CHANGE

Mexico City and Barranquilla print *"burn this card if it has no blood /
counters"*; New York prints *"burn this card when the last blood counter
on it is removed"*. Those read like two rules and a knob to tell them
apart — and the knob is the thing to get backwards, because **New York
enters play empty by design** and is bought up later.

They are one rule here: `settleBloodStore()` runs after every change a
store makes to its own counters, and **never at put-in-play**. New York
survives its own first turn for free; Mexico City burns the turn its drip
runs dry. No second field, nothing to set the wrong way round.

`settleBloodStore` is a **function**, not three inline checks — the
controller's draw-down, the mandatory drip and the raid empty the card by
three different doors, and the "rules inside a loop are not shared; a
function is" lesson from wave 53 applies to rules inside three callers
just as well.

## §4 The raid: `vulnerableTo.outcome: "takeCounters"`

*"A vampire controlled by another Methuselah can move all the blood on
this card to his or her controller's pool as a Ⓓ action."*

`vulnerableTo` already had `burnCounters` (Powerbase: Madrid, "burn ALL
the counters from this card"). The raid is **not** that: the counters go
somewhere. New outcome, new verb segment `:raid:`, and the resolution
emits `PoolGained` to `af.actingSeat` before calling `settleBloodStore` —
because a raid empties the card by the same rule its controller does.

### What this found: a fourth list of the same verbs, in a regex

Adding an outcome means teaching **four** places, and only three of them
are in `vulnerableGrant` where you are already typing:

1. the `verb` ternary (the option id segment),
2. the `grantedEffect.key` ternary (what gets announced),
3. `resolveGrantedAction` (what success does), and
4. — three thousand lines away —
   `owns: (id) => /:(burn|steal|shuffle|strip|vote):/.test(id)`,
   the provider-dispatch predicate on the composed granted-action handler.

Miss the fourth and the card compiles, typechecks, enumerates its option
correctly, is offered to the right minions with the right stealth — and
**throws when anyone takes it**: *"no granted-action provider owns
act:Powerbase: Chicago:pc:raid:W"*. The scenario test caught it on the
first run; nothing else would have, because the failure is at
announcement and the option list is perfect right up to that point.

This is "one question asked in two places will drift" with the second
place written as a **regex**, which is why grepping for the outcome names
does not find it. The three ternaries at least sit together and read as a
set; the regex is a fifth spelling of the same vocabulary, kept in sync by
nothing. Left as-is for now (deriving it from the outcome union is a
refactor of the whole granted-action composer), but it is the first thing
to check when the next `vulnerableTo` outcome lands.

## §5 `start.capacityOfReady` takes the MAX, and that is not a shortcut

*"Put X blood on this card when it is played, where X is the capacity of
a ready Sabbat vampire you control"* is a choice, and the engine does not
raise a frame for it: it takes the largest eligible vampire.

That is correct play in **every** line, not merely the usual one.
Barranquilla pays its controller 1 pool a turn and its counter-play BURNS
the card rather than stealing the blood, so a bigger pile is never a
bigger target — there is no state in which fewer counters is better. A
choice frame here would ask a question with one answer, and every seat
(and every bot) would answer it the same way.

The reasoning is written into the spec comment, because the next card of
this shape may well be one where it does **not** hold — one whose
counter-play takes the blood, where over-banking feeds a raider.

## §6 Also new: `stealthFor[].titled`

*"Titled vampires get +1 stealth on that action"* (Barranquilla). The
per-actor stealth riders had `clan` and `sect`; `titled` reads the same
`m.title` — printed or card-granted — that `who.titled` four lines below
it already read. A rider filter and an eligibility filter asking the same
question about the same field is the shape that drifts, so they now sit
in the same paragraph of code.

## §7 What was already there

Worth recording, because the wave's cost was almost entirely §4 and §5:

- **`putPermanentInPlay({ counters })`** already existed — the master
  compiler simply never passed it, because no master in the pool had
  entered play with counters.
- **`ops.spendMasterAction()`** and the `usesMasterAction` gate existed
  from `masterPhaseBurn` (wave 26's retainer prices), so New York's
  master-phase purchase cost one line each.
- **`addLocationAbilities`** is the composing home for location
  abilities — it grafts onto whatever `abilityOptions` the type compiler
  produced and dispatches by an `act` param, which is why adding a sixth
  clause here cannot silently delete a hunting ground's blood grant.
  (Wave 58 did not need that protection; the note is why it was available.)

## §8 Tests

`tests/cards/blood-banking-locations.test.ts`, 13 cases. The negatives are
the point:

- Chicago's either/or is spent after one use (not "both are offered").
- `cardToPool` is **not** offered on an empty card, while `bankToCard`
  still is.
- Washington offers `:1` at 2 pool and **not** `:2` or `:3`.
- New York is offered **nothing** with the master action already spent,
  and an empty New York is still in play.
- Mexico City's drip is offered to **nobody** — it has no "may".
- Mexico City's raid is offered to a camarilla vampire **not at all**, and
  to the same vampire made Sabbat.
- The raid is not offered to the card's own controller.

## §9 Left behind

The other blood-on-a-card locations are a different clause each and do not
share this primitive: **Powerbase: Berlin** (a Ventrue-only deposit action
*and* a lock-to-grant-intercept clause *and* a steal referendum),
**Powerbase: Rome** and **Heartblood of the Clan** (Giovanni, §7),
**Jungle Hunting Ground** and **Threestar Cab Company** (hunting grounds
whose blood pools on the card — these would take `bloodStore` plus the
hunting-ground once-per-turn-per-vampire rule, and are the natural next
wave in this vein), **Swiss Cut** and **Inveraray**.
