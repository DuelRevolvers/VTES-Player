# Answering a bleed: redirect it, or shrink it

*Redirection (101578), Bait and Switch (102218), Deep Ecology (102219),
Visions of Zapathasura (102265).*

## 1. The cluster

Four reactions that answer a bleed aimed at you, in the two ways the game
allows: **send it somewhere else**, or **make it smaller**. Both halves
already exist as primitives — `redirectBleed` (Deflection, My Enemy's
Enemy) and a negative `modifyBleed` (Party Out Of Bounds) — so this is
mostly a data wave, with three small additions.

| Card | Answer |
|---|---|
| Redirection `[dom]` | redirect, but only a **younger** vampire's bleed; `[DOM]` any age |
| Bait and Switch | redirect; requires a **baron** rather than a discipline |
| Deep Ecology `[for]` | −2 bleed (its other two modes are an intercept and an unlock) |
| Visions of Zapathasura | −3 bleed; superior reduces it **to 0** |

## 2. Redirection and Bait and Switch are Deflection with different gates

Both print the same body as Deflection — *"Lock this reacting vampire.
Change the target of the bleed to another Methuselah other than the acting
minion's controller (that Methuselah can attempt to block)"* — so
`redirectBleed { lockSelf: true }` and the existing target enumeration
(every seat but the reactor's and the actor's) cover them outright.

What differs is who may play them:

- **`afterBlocksDeclined`** — already a usable rule, and both cards carry
  it where Deflection does not.
- **`redirectBleed.youngerOnly`** — new, and only because Redirection's
  two modes differ by exactly this: "only usable if a **younger** vampire
  is bleeding you" at `[dom]`, "the acting vampire can be the same age or
  older" at `[DOM]`. Age is `capacityOf` on both sides, so a granted
  capacity counts.
- **`requiresTitle: ["baron"]`** — Bait and Switch's gate, already
  supported and not a discipline at all.

## 3. "Reduce a bleed against you to 0"

> "(The acting minion can still increase the bleed amount.)"

The exact twin of Night Terrors' stealth clause from the previous wave,
and it works for the same reason: `currentBleed` is a **fold** over
`BleedAmountModified` on top of a base, so emitting `delta = −currentBleed`
*is* the reduction, and anything played afterwards still adds on top.
`setBleedZero` needs no floor, no clamp and no new kind of modifier.

**Recorded reading: a reduction is not "(limited)".** p. 20's one-limited-
bonus rule is about a bleed *bonus*; these cards say only "reduce", they
are played by the defending Methuselah, and Party Out Of Bounds (already
supported) set the precedent with `limited: false`. So two reductions
stack, and a reduction does not spend the acting minion's allowance.

## 4. Deep Ecology is three unrelated answers on one card

Its `[for]` mode is the bleed reduction above; the other two modes are in
this wave only because they are on the same card:

- `[ani]` "+2 intercept" under `actionDirectedAtYou`, which exists.
- `[pro]` "Only usable by a locked vampire. This vampire burns 1 blood to
  unlock." — `byLockedMinion` plus `unlockMinion`, which had no cost.
  **`unlockMinion.bloodCost`** is new, the same shape
  `unlockAndAttemptBlock` and `failBlockAttempt` already use, and it gates
  the option as well as charging it (p. 9: a minion without the blood
  cannot play the card).

Its "Requires an Anarch" is `requiresSect`, and worth noting only because
the `meetsRequirements` bug recorded in CLAUDE.md was exactly a card whose
requirement line went unenforced on a reaction — that path is now checked,
and this card exercises it.

## 5. Rulebook citations

- p. 9 — a minion needs the blood to play a card with a blood cost.
- p. 12 — who may play reaction cards.
- p. 20 — only one LIMITED bleed bonus per action (the rule §3 says does
  not apply to a reduction).
- p. 23 — bleeding, and that a bleed targets a Methuselah.
- p. 27 — B.2/B.4: the target cannot be changed while a block attempt is
  underway, which is why these cards are "after blocks are declined".
