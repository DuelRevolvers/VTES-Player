# Archetypes — design

Four Master cards of one shape: **"Put this card on a vampire you control.
Once each turn, \<trigger\> → \<small benefit\>. A vampire can have only one
archetype."**

| Card | id | Trigger | Benefit |
|---|---|---|---|
| Dabbler | 100485 | after an action resolved (success or not) in which this vampire used **3+ Disciplines** to play cards | burn 1 blood to unlock, **or** gain 1 blood |
| Monster | 101242 | after a **combat involving this vampire ends**, if the opposing minion is not ready | burn 1 blood to unlock |
| Perfectionist | 101388 | after a **successful action** in which **no reaction cards** were played | gain 1 blood |
| Rebel | 101564 | this vampire **blocks a titled vampire or a political action** | gain 1 blood, before block resolution |

The attach-and-exclude half already exists: `permanent.attach` +
`exclusiveKey: "archetype"`, both built for Saulot's Avenging Fist
(docs/granted-rush-design.md §5). What is new is the trigger half.

## 1. "Once each turn" — `PermanentInPlay.usedThisTurn`

There is a `usedThisPhase` flag (reset in the unlock sweep, used by the
hunting grounds) but nothing per *turn*. `usedThisTurn` is optional
(undefined reads as false, so every existing fixture is untouched) and is
cleared on `TurnBegan`, beside `grantedActionUses`, which resets there for
the same p. 20 reason.

It is set when the benefit is **taken**, not when the trigger fires:
declining a Dabbler offer does not spend the turn's use.

## 2. Three additive hooks

All three fire at an event the engine already emits, at a site where the
frame the hook needs is still on the stack:

- **`onActionResolved`** (Dabbler, Perfectionist) — at the `ActionResolved`
  emit, carrying `{ actionId, success, acting, actingSeat }`.
- **`onCombatEnded`** (Monster) — at the `CombatEnded` emit, carrying
  `{ acting, opposing, rounds }`. The event itself only carries the round
  count, so the hook reads the combatants off the frame before it pops.
- **`onBlockDeclared`** (Rebel) — at the `BlockDeclared` emit, which is
  **before** the attempt resolves. That is exactly Rebel's "before block
  resolution": the blood arrives whether the block succeeds or fails.

## 3. Dabbler and Perfectionist need NO new state

Both look backwards at what was played during an action, and
**`ActionFrame.played` already records it** — every card played by a minion
during the action, as `{ minion, card }`, pushed in one place in
`playCard`. It exists for the p. 10 "same card once per action per minion"
limit; these two cards are a second reader of the same list.

- **Perfectionist** — "no reaction cards were played" means *by anyone*, so
  it reads the whole list, not just its bearer's plays. A reaction is
  played by a minion, so it is always recorded.
- **Dabbler** — "this vampire used 3 or more Disciplines to play cards"
  filters to its own bearer.

Neither needs the engine to expose card types or disciplines, because the
specs are in the same module: the handler resolves each recorded card name
through `specByName` and reads its `cardType` and its modes' disciplines.
(Exposing disciplines on `CardHandler` is still wanted eventually — it is
what the deferred Hide the Mind needs — but it is not needed here, and
adding it for one card would be speculative.)

### The Dabbler ambiguity, and the reading taken

A mode's discipline can be a single code, `{ all: [...] }` ("requires
both"), or a plain array meaning **"any one of these"** ("[cel] or
[pre]"). For the third shape the engine never records *which* one the
vampire used, because nothing has ever needed to know.

Reading on record, since counting distinct Disciplines forces the
question:

- a single code contributes that Discipline;
- `{ all: [...] }` contributes **all** of them — the card required all of
  them, so all were used;
- **"any one of"** contributes exactly **one**: the first listed Discipline
  the acting vampire actually has and has not already been counted for.
  Preferring an uncounted one is the reading most favourable to the card,
  and it never invents a Discipline the vampire does not have.

A card with no Discipline requirement contributes nothing. The threshold
is 3 or more *distinct* Disciplines across all the cards that vampire
played during the action.

## 4. Optional vs automatic

Three of the four say "**can**" and are therefore optional `ChoiceFrame`s
raised on the archetype's controller (docs/choice-frames-design.md), with
Dabbler's being the only two-option one ("either burn 1 blood to unlock or
gain 1 blood").

**Rebel says neither "can" nor "may": "this vampire gains 1 blood".** It is
automatic, so it fires from the hook directly with no question asked. The
distinction is worth keeping sharp — a choice frame for a mandatory effect
is a decision point that should not exist, and the standing rule is never
to ask a player something with only one answer.

Dabbler's two options are also gated on being *possible*: "burn 1 blood to
unlock" is only offered to a locked vampire with blood to burn, so a
Dabbler that is already unlocked simply sees the gain option. When the
whole choice would be empty the frame pops harmlessly.

## 5. Rebel's condition

"if they block a titled vampire or a political action" — two independent
conditions on the action being blocked:

- the **acting minion** is a vampire with a `title`; or
- the **action is a political action**, which the frame's card resolves to
  (`cardType === "politicalAction"`).

Note it triggers on the **block being declared**, not on it succeeding —
"before block resolution" is explicit, and a failed block still blocked
nothing. The bearer must be the blocker.

## 6. Deferred from this cluster

**Saulot's Guiding Wisdom (102258)** and **Saulot's Healing Touch
(102259)** are archetypes too, but neither is a "once each turn, small
benefit" card:

- **Guiding Wisdom** grants a unique Independent title worth 2 votes, can
  lock to **force a vampire to abstain**, and can lock to end a combat
  involving another of your minions. The abstain clause lands squarely on
  the recorded abstain/cancel-cast/post-tally deferral (Scalpel Tongue,
  Telepathic Vote Counting, Scorn of Adonis, Expulsion, Yoruba Shrine), so
  the card waits for that gate rather than shipping two thirds
  implemented.
- **Healing Touch** modifies the *cost of the rescue action* (−2 blood, so
  free) and grants a "+1 stealth action to add 1 blood or life to another
  ready minion, not to exceed starting life". Both are real mechanics —
  an action-cost modifier from a card in play, and an ally life cap — that
  belong in their own pass rather than bolted onto this one.
