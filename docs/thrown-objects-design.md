# Thrown objects

Wave 73 (2026-09-19). Sacrament of Carnage (101669), Thrown Gate (101982),
Mercury's Arrow (101202), Thrown Sewer Lid (101983), Well-Aimed Car (102171).

Five ranged strikes with riders, two gated on the RANGE and one also on the
ROUND. **No new primitive and no new gate** — the cards are a lens, and what
they found is three defects in machinery that was already there and looked
finished.

---

## §1 — What each card is

| Card | Basic | Superior | Gates |
| --- | --- | --- | --- |
| Sacrament of Carnage (1 blood) | 2R | 3R | none — the control |
| Thrown Gate | 1R + maneuver | 2R + maneuver | none |
| Mercury's Arrow (1 blood) | 1R + maneuver | 3R | none |
| Thrown Sewer Lid | 3R | 3R + press | long range |
| Well-Aimed Car | 4R | 4R + press | long range, **not round 1** |

Thrown Gate carries its maneuver rider at **both** levels and Mercury's Arrow
at the **inferior only**. They are in one wave for that reason: a rider
quietly copied onto the superior is invisible in a test that plays one mode,
and the two cards are each other's control.

Sacrament of Carnage earns its place by having **no** rider and **no** gate.
Four gated cards and nothing ungated is a wave that cannot tell "the gate
works" from "the card is broken".

## §2 — Both gates already existed (check the tree)

`onlyAtLongRange` and `onlyAfterFirstRound` are both already in the
`UsableWhen` union and both already enforced. A first grep found only the
**weapon profile's** copies of the same two ideas and suggested the mode-level
gates needed building — they did not. This is the standing lesson in its
cheapest form: *"it already exists" is a claim to CHECK, not to make* — and it
cut this wave's work in half.

## §3 — Two credits that outlived their sentences

### The round gates were only checked in one window each

The range gates were hoisted above the window switch at some point, with a
comment saying so. **The round gates were left behind.**
`onlyAfterFirstRound` was checked only inside `combat.chooseStrike` and
`onlyFirstRound` only inside `combat.beforeRange`, so either clause printed on
a card whose effect lives in any other window did nothing at all.

Well-Aimed Car's strike happens to be a `chooseStrike` play, so its own gate
worked — **by luck, not by design**. Both gates now sit beside the range
gates, above the switch.

This is the same shape as *"a rule welded to a card type is not shared, it is
merely nearby"*: the two pairs of gates read as a set, and one pair had been
generalised while the other stayed where it was written.

### "…with an optional press" was granting a COMBAT-LONG press

> "The optional press can only be used during the current round."
> [TOM 19960521]

All four strike-rider sites called `grantCombatPress`, which is the pool that
survives the whole combat — the one meant for a card that SAYS "this combat"
(Form of the Wolf). So a press from a strike rider could be spent two rounds
later.

The ruling is printed on **Backflip**, which has been in the pool since the
strike-source wave, and the test covering it asserted `pressesCombat` — the
wrong pool — so the defect had a passing test sitting on top of it. All four
sites now use `grantPress` (per-round).

Exactly the shape of wave 72's prevention credit, one field over: a credit
whose primitive was documented round-scoped and written to the combat-long
pool. **When a family has two pools, check which one each member writes to.**

## §4 — What the fuzz found: a card in two zones at once

Adding these five cards to the fuzz decks turned seed 7 red with a
**duplicate option id** — read as a report about the engine first, per the
standing lesson, and it was one.

`resolveCardPlay` files a played card to the ash heap "unless it went into
play instead", and it asks that question at **card** resolution.
**Molotov Cocktail** puts itself in play at **strike** resolution — its own
compile comment says "the attach IS the strike, so it waits". So the Cocktail
was filed, then attached, and lived in the ash heap **and** in play at the
same time. Every ash-heap card offered it twice (the duplicate id), and
`onCombatEnded` burned it twice.

This is the documented trap almost word for word: **a strike is CHOSEN in one
window and RESOLVED in another**, and a guard that reads a state the later
window changes is evaluated too early.

Fixed at the chokepoint rather than by teaching the filing guard to predict
the future: **`PermanentEnteredPlay` removes the card from every ash heap**,
because a card cannot be in play and in a pile. The strike that never resolves
— a dodge, or "combat ends" from the other side — needs no special case: the
card simply stays filed, which is what the [ANK 20200203-1] ruling on the
Cocktail already says. `CardToAshHeap` is idempotent as well, so a second
filing cannot re-create the duplicate from another path.

**The fuzz's duplicate-id message was itself unreadable**: it printed the
DEDUPED set of ids — the one view of the list in which a duplicate cannot be
seen. It now prints the ids that actually repeat, plus the window and seat.
That is what made a 23-option list diagnosable in one run instead of by
bisection.

## §5 — A fixture note

`m.blood = 6` on a capacity-5 vampire is silently clamped to 5, so every
damage assertion built on it is off by one and reads like a damage bug. The
fixture now sets `m.blood = m.capacity` and the damage assertions are relative
to what was there before the strike.

And a strike card's riders are granted in `resolve`, which is **after** the
as-played window has gone round the table — reading a credit straight after
`choose` reads it before the card has done anything.
