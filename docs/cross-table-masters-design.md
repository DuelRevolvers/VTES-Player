# Masters that reach across the table

*Golconda: Inner Peace (100842), Archon Investigation (100085), Anarch
Troublemaker (100058), The Coven (100435), Giant's Blood (100824).*

## 1. The cluster

Master is the largest unsupported family (17), and CLAUDE.md's queue said
it had "no cluster left with a shared mechanic — a genuine one-off tail".
That was true of the *mechanics* and wrong about the *shape*: five of the
twelve buildable Masters (four are Path-blocked, one zombie-blocked) share
one property that turns out to drive their design — **another Methuselah
is a participant, not a bystander**.

| Card | Who else is involved, and how |
|---|---|
| Golconda: Inner Peace | removes **their** vampire from the game — and **they can pay to cancel it** |
| Archon Investigation | played **out of turn**, burns the minion bleeding you |
| Anarch Troublemaker | **hands the card to your prey**, plus a parting shot |
| The Coven | **hands itself to your predator**, every discard phase |
| Giant's Blood | "choose a vampire" — **any** Methuselah's |

Two of these mechanics are new gates, and one of them retires a recorded
deferral from another doc.

## 2. PAY-TO-CANCEL — the new gate

> Golconda: Inner Peace: "Their controller **can burn 2 pool to cancel
> this card as it is played**."

Every cancel the engine has is a **card** cancelling another card (Sudden
Reversal, Hide the Mind, Meditative Grove's frenzy cancel). This is a
Methuselah paying **pool** out of hand, with no card involved, in the
as-played window.

**It is a built-in option, not a ChoiceFrame.** The as-played window
already cycles every seat, so the paying seat is *already being asked* —
raising a frame would interrupt a decision they were about to get anyway.
That is the Dawn Operation ruling (`cancelblock:` beside
`burn:intercept:`), applied again: `cancelpay:<cardId>`.

**This retires the True Love's Face deferral** recorded in
`docs/bleed-riders-sweep.md`: "its superior lets the *blocking minion's
controller* burn 1 pool to cancel the card as it is played; pay-to-cancel
by an opponent is a real mechanic, not a rider." It is the same mechanic
with a different payer, so `CardPlayFrame.payToCancel: { seat, pool }` is
the general form and True Love's Face becomes data.

`cancelPendingCard(refundCost)` already exists and is what Sudden Reversal
calls. **The cost is NOT refunded here**: Sudden Reversal prints "its cost
is not paid", and Golconda prints nothing of the kind — an unstated
refund would be inventing text.

## 3. Removing a card from the game (p. 16)

> "Sometimes, an instruction may say to remove a card from the game. While
> some cards and effects can retrieve cards from the ash heap, cards that
> are removed from the game cannot be retrieved or affected in any way.
> When a card is burned **or removed from the game**, any counters or
> other cards on it are burned."

The ash heap is unmodelled and BLOCKED, so today a removed card and a
burned card end up in the same non-place. **The distinction that is real
right now is the hook**: `notifyLeaveReady(minion, how)` carries
`"burned" | "torpor"`, and cards keyed on `how: "burned"` (Fame's
`leaveReadyDrain`) must **not** fire for a removal — Golconda is not a
burn, and the rulebook lists them as two things in one sentence.

So `how` gains `"removed"`, and every existing consumer keeps its
behaviour because they all test for a specific value. The counters-and-
attachments sweep is shared with burning, which is what the same sentence
says.

**Reading on record: the controller's pool gain is not conditional on
anything.** "Their controller gains pool equal to the vampire's capacity"
— `capacityOf`, so a Discipline master's granted point counts, which is
consistent with every other capacity read since the derived-traits wave.

## 4. Handing a card in play to another Methuselah

Anarch Troublemaker and The Coven are the pair CLAUDE.md flagged as "the
only pair" in the Master tail, and they need nothing new:
`changePermanentControl(cardId, to)` was built for the control-change
gate, and `preyOf` / `predatorOf` name the recipient.

What differs is who chooses and when:

- **Anarch Troublemaker** is *optional*, in your unlock phase, and the
  handover is the **price** of a parting shot ("give your prey control …
  **and either** lock up to two vampires they control **or** burn an
  equipment on one of their minions"). Two payoffs, so one option per
  legal choice, in the option id.
- **The Coven** is *automatic*, in your discard phase, and it is a pure
  cost — the card is a trifle that gives 2 blood a turn and then walks to
  your predator. `onDiscardPhase` is the hook it needs; `onMasterPhase`
  and `onInfluencePhase` already exist and this is their sibling.

**Reading on record: The Coven's handover is not optional.** "Your
predator takes control" — no "you can". The Rebel precedent: "gains", not
"can gain", fires from the hook with nothing asked.

## 5. Archon Investigation: an out-of-turn master with a condition

> "Out-of-turn. Only usable if a minion is bleeding you and the bleed
> amount is **4 or more**, after blocks are declined. Burn the acting
> minion. (The action is not successful.)"

Every piece exists: `isOutOfTurnMaster` and the `outOfTurnMasterUsed` debt
(Sudden Reversal), the `afterBlocksDeclined` usable rule, `currentBleed`
for the amount, `burnMinion`, and `failAction()` — built for Expulsion,
which is exactly "(the action is not successful)" and reuses the
`step = "blocked"` path.

The one thing worth stating: **the bleed amount is read when the card is
played**, not at announcement. `currentBleed` is a fold over the event
log, so it already includes every modifier played since — which is what
makes "after blocks are declined" the right window for a card that cares
about the final number.

## 6. Giant's Blood: uniqueness the engine already knows

> "Only one Giant's Blood can be played in a game. Choose a vampire. The
> chosen vampire gains enough blood to reach full capacity."

Game-wide uniqueness is the Week of Nightmares / Open War precedent and
**needs no new state**: the event log is the record of everything ever
played, so it is `eventLog.some(ev => ev.type === "CardPlayed" && ev.name
=== …)`. Correctly stricter than "in play" — a second copy stays
unplayable after the first is burnt.

"Enough blood to reach full capacity" is `capacityOf(m) - m.blood`, one
option per candidate vampire, any Methuselah's. A vampire already at
capacity is not offered — the option would do nothing, which is the
standing habit (a burn-equipment strike with nothing to burn).

## 7. Rulebook citations

- p. 7 — the as-played period: only cancels and wakes.
- p. 8 — out-of-turn master cards cost the player their next master phase
  action.
- p. 11 — a vampire cannot hold more blood than its capacity.
- p. 16 — control vs ownership; **burning and removing from the game**,
  and that counters and attached cards go with either.
- p. 25 — action details are fixed at announcement.
- p. 37 — the discard phase.

## 8. Readings on record

1. **Golconda's cost is not refunded when cancelled** (§2) — Sudden
   Reversal prints the refund; this card does not.
2. **A removal is not a burn for hook purposes** (§3) — p. 16 names them
   as two things.
3. **The Coven's handover is mandatory** (§4) — "takes control", not "can
   take control".
4. **Giant's Blood is not offered on a vampire already at capacity** (§6).
