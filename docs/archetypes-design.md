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

## 7. Wave 107 — five more, each paying 1 blood once per turn

October 23, 2026, version 0.11.45. All five keep the §0 skeleton and say
"gains 1 blood from the blood bank" with no "can" or "may", so all five are
automatic, like Rebel (§4). They share one helper, `archetypeGain`, which
spends the turn's use when the blood arrives (§1).

| Card | id | Needs | Trigger | Hook |
|---|---|---|---|---|
| Bravo | 100247 | any vampire | its successful action to enter combat ends, and it's still ready | `onCombatEnded` + `rushBy` |
| Capitalist | 100292 | Sabbat | it successfully bleeds its prey | `onBleedSuccess` |
| Creep Show | 100442 | Sabbat, trifle | the opposing minion dodges or ends combat as a strike | `onStrikeResolved` (new) |
| Guru | 100872 | Sabbat | it calls a referendum and the referendum passes | `onReferendumPassed` (new) |
| Sociopath | 101823 | Sabbat | it remains ready and burns, or sends to torpor, the opposing minion | `onCombatEnded` + `leftReady`, and `onCombatLeave` |

None is inert: the V5 crypt has Sabbat vampires, and `permanent.attach.sect`
already existed.

### 7.1 What each reading takes

- **Bravo.** An action that enters combat is a rush. The rush's own combat
  now records its actor (`CombatFrame.rushBy`), so a block's combat, where the
  action did not succeed, doesn't count. Neither does a combat a card queued.
  "Still ready" is `isReady` when the combat ends.
- **Capitalist.** "Successfully bleeds" is the rulebook's term: "If the action
  succeeds and the bleed amount is 1 or more, then the bleed is successful"
  (p. 21). That's when `onBleedSuccess` fires. A bleed redirected to another
  Methuselah isn't a bleed of the prey. The blood arrives before the
  after-resolution window [ANK 20190113].
- **Creep Show.** Read as each strike resolves, before damage. A "combat ends"
  strike resolves before anything else (p. 33), so a dodge played opposite it
  never resolves and pays nothing. The bearer's own dodge doesn't count.
- **Guru.** The blood arrives after the referendum's effects apply [LSJ
  20090115-2]. `onReferendumPassed` fires right after `applyReferendum`, for
  political referendums only. A blood hunt has no calling vampire.
- **Sociopath.** "Remains ready" can only be answered once all the damage is
  in. Strikes resolve together, but damage is applied acting minion first
  (p. 29), so when one combatant leaves, the other hasn't taken its damage
  yet. A check made at that moment pays whichever side goes second. The card
  therefore asks at two moments:
  - The opponent left during the combat: the engine records it in
    `CombatFrame.leftReady`, and Sociopath checks at combat end.
  - The opponent was going to torpor (Minor Boon's window): it arrives after
    the combat, through `onCombatLeave`, and only if nobody kept it out.

  On both paths the leave must come from **this vampire's strike** (owner
  ruling, §7.5). Each leave records `by`, the combatant whose strike caused
  it: `PendingDamage.source` for damage, the striker for an incapacitate
  strike, and null for anything else (a retainer's or environmental damage,
  p. 31). A pending torpor carries `by` on `TorporPending` until it arrives.

### 7.2 Found, two defects fixed

1. **The combat-leave hook never reached an attached card.** `fireCombatLeave`
   walked `seat.permanents` only, so Egidia Arrú (G6)'s "after a minion in
   combat with Egidia leaves the ready region, their controller burns 1 pool"
   never fired. A crypt ability is attached. This is the bug `onBleedSuccess`
   and `onAnyUnlock` had before. **Her test was named for the drain and
   asserted only her +1 strength**, so it passed while the drain did nothing.
   The hook now uses `allEntries()`, and the test plays the combat both ways.
2. **Monster missed an opponent going to torpor.** It read `!other.inTorpor`,
   which is false for a vampire held in Minor Boon's window, though that
   vampire has already left the ready region. It now reads `isReady`. Wave
   104's torpor window (docs/boons-design.md §4) added that third "not ready"
   state after Monster was written.
3. **An ally killed by a strike never left its combat** (0.11.46, found
   applying ruling 2). Damage emptied the ally, and `burnDepleted` burned it
   at the next settle, which fires no combat-leave hook. So Sociopath could
   not pay for burning an ally, and Egidia Arrú's drain never fired for one.
   `applyResolvedDamage` now burns an emptied ally on the spot and reports
   the leave. `burnedByStrike` now records vampires only, since its one
   reader asks whether "the opposing vampire" was burned.

### 7.3 Left out: Traditionalist (102005)

"When this vampire casts his or her votes or ballots against a referendum and
the referendum fails." **The engine doesn't record which vampire cast a
card-granted vote.** Dread Gaze, Surprise Influence, Party Out Of Bounds and
Protected District each give votes to the vampire that plays them, and
`grantVotes` files them per seat. A Traditionalist that plays one and votes
against would get nothing.

The same gap is a rules deviation already in the pool. p. 28: "all of the
votes and ballots from any given vampire or other source must be cast in
agreement as a group." A granted vote is its own source, so a seat can cast a
vampire's Dread Gaze votes one way and its title votes the other.
Traditionalist belongs in a wave that attributes votes to vampires.
**Built in wave 108 (0.11.48)**, `vampire-votes-design.md` §5.

### 7.4 Measured

A 150-seed fuzz with a temporary tally: all five cards offered, four played
(Guru was offered once and not taken), Bravo and Capitalist paid out. The
scenario tests in `tests/cards/archetypes.test.ts` cover every trigger and its
negative space.

### 7.5 Questions for the owner

1. **Creep Show and an undodgeable strike.** A dodge played against an
   undodgeable strike protects nothing, but the opponent still dodged. This
   build pays. **ANSWERED 2026-10-23: keep it.** It pays.
2. **Sociopath and what caused the leave.** **ANSWERED 2026-10-23: only this
   vampire's own burn or torpor counts.** Built in 0.11.46 (§7.1, §7.2 item
   3). Two tests pin it: an ally burned by the bearer's strike pays, and a
   torpor from the bearer's retainer, with the bearer dodging, pays nothing.
3. **Bravo and a vampire going to torpor.** One held in Minor Boon's window
   at combat end isn't ready yet. **ANSWERED 2026-10-23: it pays.** The boon
   means the vampire never went to torpor, so it never stopped being ready.
   Built in 0.11.47: `TorporPending` and `MinionState.torporPending` carry
   the combat's `rushBy`, and Minor Boon calls `ops.preventTorpor`, which
   fires a new `onTorporPrevented` hook. Bravo pays there, after the
   `TorporPrevented` event. Two tests pin it: a boon after the bearer's rush
   pays 1 blood, and a boon after a block's combat pays nothing.
