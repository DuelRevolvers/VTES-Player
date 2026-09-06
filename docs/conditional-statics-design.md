# Conditional statics

Status: **design + implementation** (2026-08-31). Chosen by pool survey.
The queue named "the on-vampire statics masters"; the survey found a
**tighter and larger** cluster cutting across card types — five cards
whose shared mechanic is a static that applies *only during certain
actions*.

## 1. The shape

`PermanentStatics.stealth` / `.intercept` are **unconditional**: a card in
play grants them to its bearer for every action, forever. Five cards want
them only sometimes:

| id | card | type | the condition |
|---|---|---|---|
| 100526 | Depravity | Master | +1 stealth during **diablerie** actions |
| 100866 | Guardian Angel | Master | +1 intercept during **bleed** actions **directed at you** |
| 100006 | Abbot | Action | +1 intercept during actions **directed at their controller** |
| 100374 | Codex of the Edenic Groundskeepers | Equipment | **−2** stealth during **bleed** actions |
| 102078 | Unlicensed Taxicab | Equipment | +1 stealth during **hunt, recruit and employ** actions |

Master, Action and Equipment — which is the argument for making this one
mechanism rather than three. Note Codex is **negative**: the vocabulary
has to be a signed bonus, not a grant.

## 2. The vocabulary

```ts
PermanentStatics.conditional?: Array<{
  stealth?: number;
  intercept?: number;
  /** Built-in action kinds (bleed, hunt, diablerize, …). */
  actionKinds?: ActionKind[];
  /** Card-typed actions: "recruit and employ" are ally and retainer
   *  cards played as actions, which are all `cardEffect` kind. */
  actionCardTypes?: PlayCostCardType[];
  /** "…directed at their controller" (Abbot, Guardian Angel). */
  directedAtController?: boolean;
}>;
```

A list, not a single record, because one card can carry two different
conditional bonuses; every condition present must hold.

**`actionCardTypes` reuses last wave's `costTypes`.** "Recruit" and
"employ" are not `ActionKind`s — an ally or retainer played as an action
announces as `cardEffect`, like every other action card. What tells them
apart is the *printed type of the card that announced the action*, and
`CardHandler.costTypes` already answers exactly that (it was built for
`PlayCostMod.cardTypes`). So the engine stamps the announcing card's types
onto the **`ActionAnnounced` event** (`cardTypes?`, optional so existing
fixtures are untouched), and derived.ts reads them with no registry
lookup — the same denormalization the rest of the engine uses.

## 3. Where it is read

Both consumers already fold `attached` statics, so each gains one branch:

- **`currentStealth(state, actionId)`** already finds the `ActionAnnounced`
  event to locate the acting minion; the condition is read off that same
  event. The conditional bonus applies to the **acting** minion.
- **`currentIntercept(state, actionId, minion)`** did **not** look up the
  action at all — it only folded the blocker's own attachments and the
  event log. It now finds the announcement too, because
  "directed at their controller" is a question about the action.

**"Directed at their controller" is read against the minion the static is
on**, not against the seat asking. For intercept that is the blocker; the
action is "directed at" a seat (`ActionAnnounced.target` with
`directed: true`), so the test is `directed && target === minion.controller`.

## 4. What each card needed besides the static

- **Depravity**: `statics.strength` (already existed) plus **"cannot
  recruit allies or employ retainers"** — a restriction on the bearer's
  action types, expressed as `PermanentStatics.cannotPlayCardTypes`, read
  where those actions are enumerated. It is the mirror of the conditional
  bonus and uses the same `costTypes` answer.
- **Guardian Angel**: "can prevent 1 damage **each combat**" — War Ghoul's
  ability is per *round* (`CombatFrame.usedThisRound`); this is per
  combat, so it keys on a per-combat list instead. Plus "if this vampire
  is in torpor, burn this card", which the existing `onLeaveReady` hook
  already fires at the right moment.
- **Abbot**: an action card that attaches itself on success
  (`attachOnSuccess`, already built) **and unlocks the actor** — the
  acting minion locked at announcement (p. 25), so this is a real effect,
  not a no-op.
- **Codex**: a granted bleed action costing 1 blood with a conditional
  **+3 bleed if the target Methuselah controls no ready unlocked
  minions**. The granted-action machinery is built; the condition is new
  and small.
- **Unlicensed Taxicab**: vehicle (`exclusiveKey`, built), the equip
  action's own +1 stealth, and **"if this minion is blocked by a prince or
  an archbishop, burn this vehicle"** — a new `onBlockDeclared`-shaped
  trigger filtered by the blocker's title.

## 5. Readings on record

- **Codex's −2 stealth applies to every bleed the bearer makes**,
  including the bleed the card itself grants. The card gives a Ⓓ bleed and
  taxes bleeding; nothing says the granted one is exempt.
- **Unlicensed Taxicab's burn clause says "during any action"**, so it is
  not limited to the actions its own stealth bonus covers.
- A conditional bonus is applied wherever the unconditional one is, so it
  composes with everything already there (auras, event-log modifiers)
  rather than replacing any of it.

## 6. Left for a later Master pass

**Fame** (100698 — a recurring per-Methuselah pool drain while the bearer
is in torpor), **Secure Haven** (101711) and **Vast Wealth** (102092 — a
library search) are on-vampire masters but not conditional statics.

**Secure Haven is worth naming**: its "master cards targeting this minion
cost 1 additional pool" is *exactly* the **target-priced cost** deferred
from `docs/play-cost-design.md` §7 (Villein). Those two should be built
together, since one extension serves both.
