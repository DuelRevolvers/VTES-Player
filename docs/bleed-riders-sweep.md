# Enhanced bleeds and their superior-mode riders

Status: **design + implementation** (2026-08-30). The **Next** queue is now
empty of gates — every reusable mechanic gate is closed — so this is the
one-off sweep proper (`docs/one-off-sweep.md`), and the cluster is chosen
by what the remaining pool actually contains rather than by a queue entry.

## 1. Choosing the cluster

A survey of the 195 unsupported library cards by shape:

| family | count |
|---|---|
| bleed modifiers / enhanced bleeds | 30 |
| strike effects | 22 |
| press / maneuver combat cards | 17 |
| intercept reactions | 14 |
| "burn a location" granted actions | 3 |
| Methuselah-level master-phase actions | 2 |

The bleed family is the largest, but most of its 30 are multi-clause cards
whose "+1 bleed" is one line. The coherent, buildable sub-family is
**enhanced bleed ACTION cards** — "Ⓓ Bleed with +N bleed" at inferior, a
rider at superior — where every rider is either already a primitive or a
one-liner over an op that exists.

Five cards, four small primitives, **no kernel sequencing change**.

## 2. The cards, and what each rider needs

| id | card | inferior | superior rider |
|---|---|---|---|
| 101772 | Show of Force | bleed +1 | +1 strength in the resulting combat — **already a primitive** |
| 101495 | Propaganda | bleed +1, titled cannot block | the TARGET locks a minion of their own |
| 102229 | Line Brawl | three one-discipline modes | steal 1 pool |
| 100652 | Entrancement | bleed +1 | steal an ally |
| 102320 | Enthrall | bleed +1 | burn 1 blood to draw a crypt card |

**Show of Force is pure data.** `actionBleed` + `actorCombatRider.strength`
(the actor-riders gate) covers it exactly: the card says "+N strength that
combat", and that field is combat-scoped.

*Reading taken:* the card says the vampire **can** gain the strength, and
the rider applies it unconditionally. A pure, costless, strictly beneficial
bonus is auto-taken. This is a deliberate exception to the direction the
project has otherwise moved (Cave of Apples' and Dead Pool's optional
riders were made real choices) — those had costs or downsides attached and
this does not. Flagged for review rather than hidden.

## 3. The four new primitives

All four are small, and each maps to an op that already exists:

- **`actionStealPool { amount }`** — "Ⓓ Steal 1 pool from another
  Methuselah": the target burns it and the actor's Methuselah gains it, on
  a successful action. Directed (it targets another Methuselah), so the
  existing directedness machinery handles blocking.
- **`stealMinionOnSuccess { kind }`** — "Ⓓ Steal an ally controlled by
  another Methuselah": `changeMinionControl`, which the control-change gate
  built. The target is chosen at announcement through the existing
  `targetRider`/`enumerateActionTargets` mechanism, so it lands in the
  option id.
- **`cryptDrawOnSuccess { bloodCost }`** — "burn 1 blood to draw 1 card
  from your crypt". A crypt card drawn goes to its owner's **uncontrolled
  region** (p. 3), which is exactly what the existing `CryptCardDrawn`
  event does. Optional, so it is offered as a choice rather than taken.
- **`targetLocksOwnMinion`** — "the target Methuselah locks a ready
  unlocked minion they control". The choice belongs to the **target**, not
  the actor, so it is a `ChoiceFrame` raised to that seat — the shape
  choice-frames were built for. With no legal answer the frame pops
  harmlessly, which is already the rule.

## 4. What this sweep does NOT touch

Cards in the same family that need a mechanic of their own, left for
later and noted here so the next pass does not re-derive them:

- **True Love's Face** (102041) — its superior lets the *blocking
  minion's controller* **burn 1 pool to cancel the card as it is played**.
  Pay-to-cancel by an opponent is a real mechanic (Sudden Reversal cancels,
  but free and only masters), not a rider.
- **Deep Song** (100515) superior — "the target vampire is considered the
  acting minion during that combat", which inverts combat roles; already on
  the frenzy deferral list.
- **Dominate Kine** (100573) / **Stolen Police Cruiser** (101872) — "steal
  a location" / "burn a location", the granted-action-on-a-permanent shape
  that **Open War** also wants. That is the next real cluster: three cards
  plus Open War's two Methuselah-level clauses.
