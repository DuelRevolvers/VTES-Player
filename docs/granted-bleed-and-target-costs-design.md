# Granted bleeds, and costs priced for a target

Status: **design + implementation** (2026-08-31). Queue items 1 and 2 —
two recorded deferrals, each a hard-code in the kernel rather than a
missing mechanism, paired because neither is a wave on its own.

| id | card | which deferral |
|---|---|---|
| 100374 | Codex of the Edenic Groundskeepers | granted **bleed** actions |
| 102121 | Villein | target-priced costs |
| 101711 | Secure Haven | target-priced costs |

## 1. Granted bleeds

`announceEntryAction` — the path every action granted by a card in play
goes through — hard-coded `actionKind: "cardEffect"`. That was right for
every granted action built so far (rushes, burn-this-card, counter
actions), and wrong for **"this vampire can BLEED as a Ⓓ action"**.

The fix is the same shape as the one `announceCardAction` needed for
`targetPermanent`: one field threaded through, defaulting to the old
behaviour. `args.actionKind` defaults to `cardEffect`; when it is
`"bleed"`, the branch that `announceCardAction` already had applies —
**p. 23: one bleed per minion per turn (`bledThisTurn`), the prey as
default target, directed**. Both call sites now share that reading
instead of one of them owning it.

`permanent.bleedGrant` is the spec clause, alongside `rushGrant` and
`vulnerableTo`, and it merges into the granted-action provider list the
same way (dispatched on the `:bleed:` verb segment of the option id).

### Codex's conditional bonus

"…this action gets +3 bleed **if the target Methuselah controls no ready
unlocked minions**."

**Reading on record: evaluated at ANNOUNCEMENT.** That is when the target
is fixed (p. 25) and when every other bleed modifier is applied, so the
bonus is emitted as an ordinary `BleedAmountModified` and folds into
`currentBleed` with no special case. A minion unlocking mid-action does
not retract it. The alternative — re-checking at resolution — would make
this the only bleed bonus in the engine that is not a fold over events.

It is emitted with `limited: false`: the card does not print "(limited)",
and p. 20's rule is about action modifier CARDS.

## 2. Costs priced for a target

`playCostFor` prices a card for its **payer**. Two cards price it for the
card's **target**:

- **Secure Haven**: "Master cards targeting this minion cost 1 additional
  pool" — a toll on *other people's* cards, keyed to the minion the haven
  sits on.
- **Villein**: "Villein costs +1 pool to play **on this vampire**" — a
  card raising the price of further copies of itself, per vampire.

So `PlayCostMod` gains **`onTarget`**: the modifier applies when the card
being played targets the minion whose card radiates it. That is a
different question from `minions` (`bearer`/`others`), which asks who
*pays*, and both can be true at once.

`playCostFor` and `activePlayCostMods` take a `target` alongside the
payer; `costOf` and `priceOf` — still the only two wrappers — thread it.

### Disambiguating the target, without changing option ids

The chosen attach target already rides in the option as `params.target`.
But `target` is **overloaded**: Deflection's `target` is a SEAT, not a
minion. Rather than rename it and break every existing option id and
trace test, the engine resolves it through `findMinion`, which is total
and returns null for a seat id. A card that targets a seat therefore
prices as it always did.

### Villein also needed a seat scope

"Cards named *Minion Tap* cost **you** +1 pool" is the controlling
Methuselah's problem alone, not the table's — `PlayCostMod.controllerOnly`.
It was noted as missing when the play-cost gate was built and deliberately
not built then, because nothing used it. Villein uses it.

## 3. Secure Haven's other clauses

- **"This minion cannot be the target of other Methuselahs' actions"** —
  `PermanentStatics.untargetableByOthers`, checked wherever an action
  picks a *minion* target (rush targets, diablerie, rescue). A bleed
  targets a **seat**, not a minion, so a haven does not stop bleeds; that
  falls out of the model rather than needing a rule.
- **"Burn this card after this minion goes to torpor"** — `onLeaveReady`,
  exactly as Guardian Angel uses it.
- **"A minion can have only one haven"** — `exclusiveKey: "haven"`.

## 4. Villein's blood move

"Move 2 to 5 blood from that vampire to your pool" is a choice made as the
card is played, so it is the `x=N` shape already used for variable costs:
one option per legal amount, capped by the vampire's blood, with the
amount in the option id. Combined with the attach target, Villein emits
one option per (vampire, amount) pair.

`trifle` is already in the vocabulary and needs nothing.
