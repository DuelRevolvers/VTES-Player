# Stores you fill yourself — design (wave 97)

Two locations you build up and then spend, and the tax on every hunting ground
your neighbours hold — which the first of the two is.

| Card | KRCG | Cost | Text |
| --- | --- | --- | --- |
| Threestar Cab Company | 101980 | 3 pool | Unique location. Hunting ground. Lock during your master phase to move a blood from the blood bank to this card. Lock during your unlock phase to move 1 blood from this card to your pool or to a ready vampire you control. A vampire can gain blood from only one hunting ground card each turn. |
| Grand Temple of Set | 100848 | 2 pool | Unique location. During your master phase, you can move 1 counter from your pool to this card. Lock and burn X counters from this card during your influence phase to steal a vampire controlled by your prey with capacity less than X. Any vampire can burn this card as a Ⓓ action. |
| Arcanum Chapterhouse, Alexandria | 100082 | — | Unique location. Each of your predator and prey burns 1 pool during his or her unlock phase for each Hunting Ground he or she controls. Any minion may burn this card as a Ⓓ action. |

Printed text read from `data/vtes-raw.json`. Grand Temple's Ministry icon is on a
master, so it is not a requirement (p. 10).

## 1. What the wave found

No engine defect this time, and every mutation was caught on the first try. What
it recorded instead are two things that would have gone wrong silently:

**A card can be a hunting ground by TAG alone.** Threestar Cab prints "Hunting
ground" but has no "a ready vampire gains N blood" grant — the `huntingGround`
clause is exactly the wrong thing for it. What the word does is make it **count**:
Arcanum Chapterhouse charges for it, Poacher's Hunting Ground (wave 95) counts it
toward X, and its own blood to a vampire must obey "a vampire can gain blood from
only one hunting ground card each turn". So it carries the `huntingGround` tag and
a `bloodStore`, and the store learned to read the tag: a blood store on a hunting
ground sets and respects `usedHuntingGroundThisTurn`. Before this wave the store
had no idea hunting grounds existed.

**A two-valued test with a third value added falls through quietly.**
`unlockDrain.whose` was `"any" | "prey"`, tested as `whose === "any" || unlocking
=== prey` — so "not any" *meant* prey. Adding `"predatorOrPrey"` to the union
without touching that line would have compiled and charged the prey alone. The
predator branch is now named, and the mutation that removes it fails the
predator case.

## 2. The blood-store additions

`BloodStoreOffer` gained one shared field and three kinds:

- `locks` — "**Lock** during … to …": the lock is the price, a locked card offers
  nothing, and the lock outlasts the phase. Threestar locks in both phases, so its
  one lock is what stops the unlock-phase cash-out and the master-phase bank-up
  happening in the same turn. It is *not* a master action (asserted).
- `cardToVampire` — Threestar's "…or to a ready vampire you control", with the
  hunting-ground rule above.
- `poolToCard` — Grand Temple's "move 1 counter from your pool": one for one, no
  bank match (unlike Powerbase: Washington D.C.'s `poolToCardMatched`). Once a
  phase by the store's existing `phaseUses` latch — the re-offer lesson, already
  paid for.
- `burnToSteal` — "lock and burn X counters to steal a vampire controlled by your
  **prey** with capacity **less than** X". One option per stealable vampire at the
  **smallest** X that takes it (capacity + 1): burning more buys nothing, so a
  larger X is a futile option.

## 3. Arcanum Chapterhouse

`unlockDrain` gained `whose: "predatorOrPrey"` and `perHuntingGround` (the sibling
of `perTorporVampire`, counting cards in play by tag). Its own controller never
pays, and in a four-seat game the grand-prey across the table does not either —
both asserted.

## 4. Tests

`tests/cards/stores-you-fill.test.ts` — 10 cases. Threestar: banking locks and
spends no master action; the cash-out offers pool and vampire; a vampire fed from
it cannot feed from an ordinary ground this turn, and one already fed is not
offered it. Grand Temple: pool onto the card once a phase; a steal at capacity + 1
counters, refusing a vampire one capacity too dear and the predator's vampires.
Arcanum: prey and predator pay per ground (Threestar counting); the controller and
a four-seat grand-prey do not.

Mutation-checked four ways — the predator branch, the per-ground count, the
hunting-ground tag on the store, and X = capacity — each caught.

Fuzz: all three added.

## 5. Deferred

Secret Horde (an X pool cost, which masters do not support) and Powerbase: Berlin
(three mechanisms: a Ventrue action feeding the store, a block-window lock for
intercept against political actions, and a steal-by-referendum).

## 6. Counts

Library 860 / crypt 217 / total 1077; supported 959 / 1077.
