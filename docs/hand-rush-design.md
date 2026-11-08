# Hand rush cards (wave 114)

**Status: BUILT (0.11.59, 2026-11-03)** as designed, with the owner's
answers in §5.1. Six cards; Big Game waits. Two notes from the build:
the delayed replacement stays on `ActionFrame.drawAfter`, drawn in
`finishAction` beside Rumble's `poolBurnIfActorNotReady`, rather than a
new `atActionEnd` list (§4.5). And Taunt's `[ANI]` combat is queued
through `queuedCombats` as §4.6 says, so it runs after the action frame
pops. Its actor doesn't fight, so the window order can't change anything
for it.

## 0. The family

Seven action cards from the hand, each of which enters combat as a Ⓓ
action. `docs/equipment-rush-design.md` §0.1 found them, and §8 named them
as the next wave.

| Card | Id | Requirement | Rush target | Other clauses |
| --- | --- | --- | --- | --- |
| Big Game | 100159 | None | A ready minion of another Methuselah | Do not replace until after the action; a Red List branch |
| Games of Instinct | 100801 | A ready Sabbat vampire | An older vampire of another Methuselah | The one ready combatant gains blood equal to the other's capacity |
| Harass | 100886 | None | A vampire with 3 or fewer blood, or a locked minion | 1 optional press, only usable to continue |
| Monomancy | 101241 | A ready Sabbat vampire; +1 stealth | A ready Sabbat vampire of another Methuselah | The target may end combat before range in round 1; if it does, the card goes on the target with -1 bleed |
| Purity of the Beast | 101522 | A ready vampire; +1 stealth | An ally controlled by your prey | +2 strength in that combat |
| Rumble | 101661 | A Sabbat vampire | A ready minion of another Methuselah | +1 hand size in that combat; burn 1 pool if the actor isn't ready at the end of the action |
| Taunt the Caged Beast | 101947 | `[ani]` / `[ANI]` | `[ani]`: any vampire. `[ANI]`: two other seats' vampires fight each other | `[ani]`: an optional maneuver. `[ANI]`: the one ready combatant gains 4 blood |

Six cards are tranche T1, because they need no discipline. Taunt the Caged
Beast is T2, because the V5 crypt has Animalism.

**The pool can produce every target.** The V5 crypt has 48 Sabbat vampires
across 11 clans, and the pool has 44 allies. "Older" means a higher
capacity (p. 5), and V5 capacities run from 2 to 10. The one exception is
Big Game's Red List branch (§5 Q1).

**The shared primitive is `actionEnterCombat`.** Eleven pool cards use it
already, such as Bum's Rush, Ambush, Abuse of Power and Pillars Fall. Most
of this wave is new target filters, riders and end-of-combat payoffs on
that one primitive.

## 1. Printed text and rulings

Text is from `data/vtes-raw.json`. Rulings are from the KRCG card data in
the same file.

- **Big Game:** "Do not replace until after this action. Ⓓ Enter combat
  with a ready minion controlled by another Methuselah. If that minion is a
  Red List minion, this minion gets an optional maneuver or press in that
  combat and unlocks at the end of the action if he or she is still ready."
  - [ANK 20180518]: "that minion" is the target, and "this minion" is the
    acting minion.
  - [LSJ 20001120]: the card isn't replaced if the action is blocked. It's
    replaced when the action ends, after all combats.
  - [LSJ 20101021]: it's replaced after all "after resolution" cards and
    effects, such as Freak Drive.
- **Games of Instinct:** "Requires a ready Sabbat vampire. Ⓓ Enter combat
  with an older vampire controlled by another Methuselah. At the end of that
  combat, if only one combatant is ready, that ready vampire gains blood
  equal to the opposing vampire's capacity from the blood bank."
  - [LSJ 20100324]: the blood is gained after combat ends, so no combat
    card can be played afterwards. The acting player chooses the order of
    after-combat effects.
- **Harass:** "Ⓓ Enter combat with a vampire who has 3 or fewer blood or
  with a locked minion. This acting minion gets 1 optional press, only
  usable to continue combat, during that combat."
  - [LSJ 20070411] [LSJ 20090514]: if the action isn't blocked, and the
    target now has more than 3 blood and is unlocked, then the action
    fizzles. Any cost is paid and the action counts as successful, but it
    has no effect.
- **Monomancy:** "+1 stealth action. Requires a ready Sabbat vampire. Ⓓ
  Enter combat with a ready Sabbat vampire controlled by another
  Methuselah. That vampire may end combat before range is chosen during the
  first round of combat. If he or she does so, put this card on him or her;
  that vampire gets -1 bleed."
  - [RTR 20020501]: the card isn't put on the target if the target uses
    some other effect to end combat.
- **Purity of the Beast:** "+1 stealth action. Requires a ready vampire. Ⓓ
  Enter combat with an ally controlled by your prey. The acting vampire
  gets +2 strength in that combat." No rulings.
- **Rumble:** "Requires a Sabbat vampire. Ⓓ Enter combat with a ready
  minion controlled by another Methuselah. In that combat, your hand size
  is increased by one. If this acting vampire is not ready at the end of
  the action, you burn 1 pool." No rulings.
- **Taunt the Caged Beast:** "`[ani]` Ⓓ Enter combat with any vampire, with
  an optional maneuver in that combat. `[ANI]` Choose a ready vampire
  controlled by your predator and another controlled by your prey (not
  usable when only one other Methuselah is in the game). The chosen
  vampires enter combat. If only one is ready at the end of that combat, he
  or she gains 4 blood."
  - [LSJ 20070319]: in the `[ANI]` combat, the prey's vampire goes first
    for maneuvers, strikes and presses.

Rulebook citations:

- p. 5: a vampire with a higher capacity is older. Blood over capacity is
  moved to the blood bank.
- p. 27: a blocked action's combat is part of block resolution.
- p. 41: Red List is a trait. No V5 crypt card has it.
- p. 48: if the vampire was blocked, Freak Drive is played after combat.

## 2. What already exists

The survey checked the tree for each clause before designing against it.
The following pieces exist and are reused unchanged:

- **Ready targets only, never the actor.** `enumerateRushTargets` in
  `compile.ts` (~1271) already excludes torpid minions (p. 30) and the
  acting minion. Own minions are legal, which makes the action undirected.
- **`othersOnly`** ("controlled by another Methuselah") exists, but only on
  the granted-rush shape. The hand primitive doesn't accept it yet.
- **The fizzle.** `lockedOk` in `finishAction` (`engine.ts` ~9794)
  re-reads Ambush's "locked" at resolution, and `grantOk` sits beside it.
- **Riders.** `maneuver`, `press` and `strength` exist on `RushRiders`.
  Purity of the Beast's +2 strength and Taunt's `[ani]` maneuver need
  nothing new.
- **A continue-only press.** `CombatFrame.pressesContinueOnly` exists for
  combat cards that print `press, continueOnly: true`.
- **A combat-scoped hand size.** `handSizeBonus` (Rage of Apedemak) is held
  on the combat frame, and the p. 7 discard-down runs when the frame pops.
- **End-of-combat payoffs.** `outcome.when: "oneCombatantReady"` exists
  (Abuse of Power). The card can be held aside instead of burned, then put
  on a vampire (Pillars Fall's `attachToActor`).
- **A combat between two minions that aren't the actor.** Hedonism's
  `queuedCombats` pushes a combat between any two minions after the action
  frame pops, re-checks that both are ready, and carries an outcome.
- **Requirements.** `requiresSect` and `requiresVampire` exist.
- **Age.** `capacityOf` already answers "older" for Under the Skin and the
  vote-cancel offers.
- **"Do not replace until after this action."** `delayedReplace:
  "afterAction"` exists (Bum's Rush), but see §3, defect D1.

## 3. Engine defects found

The survey found two ordering defects in the rush path that is already in
the pool. Neither has a test that would show it.

**D1. "Do not replace until after this action" replaces before the rush
combat.** `resolveActionInner` draws `af.drawAfter` (`engine.ts` ~9603).
Only later does `finishAction` push the successful rush's combat (~9815).
[LSJ 20001120] says the card is replaced "after all combats". Bum's Rush
does this wrong today: its player has the replacement card in hand during
the rush combat.

**D2. The after-resolution window opens before a successful rush's
combat.** The window opens in `resolveActionInner`, and the rush combat is
pushed in `finishAction`, after it. So Freak Drive can unlock a successful
rusher before the rusher fights. The order was kept on purpose when the
window was built (`after-resolution-design.md` §2: "The ordering is
unchanged"). It preserved the old order. It isn't a reading of the rules.
The rules point the other way:

- p. 27 makes a blocked action's combat part of resolution, and the engine
  already pushes that combat with the action frame still on the stack.
- p. 48 puts Freak Drive after the combat of a blocked action.
- [LSJ 20001120] and [LSJ 20101021] together give the order as combats,
  then after-resolution effects, then the replacement draw.

A successful rush's combat is the action's effect, so it belongs inside
resolution in the same way. §5 Q2 asks how to fix this.

## 4. The design

### 4.1 One target predicate

`actionEnterCombat` gains the following filter fields:

- `othersOnly`: "controlled by another Methuselah" (Big Game, Games of
  Instinct, Monomancy and Rumble).
- `targets: "ally"`: Purity of the Beast. This joins `"minion"` and
  `"vampire"`.
- `controlledBy: "prey"`: Purity of the Beast.
- `sect`: "a Sabbat vampire" (Monomancy).
- `olderOnly`: "an older vampire" (Games of Instinct), read with
  `capacityOf` against the actor, as Under the Skin reads it.
- `maxBlood` with `orAnyLocked`: Harass's "a vampire who has 3 or fewer
  blood or a locked minion".

All of the filter fields live in one function, `rushTargetOk`. Enumeration
calls it, and so does the fizzle check at resolution, which replaces
`lockedOk` with one call. Harass's ruling is then a consequence of the
function, not a special case, and Ambush keeps its fizzle. This follows the
lesson "One question asked in two places will drift."

Harass is the reason resolution must re-read every term. Blood and lock
state change between announcement and resolution. The other terms rarely
change, but reading them all in one place costs nothing.

### 4.2 Two new riders

`RushRiders` gains the following riders:

- `pressContinueOnly: number`, which adds to `cf.pressesContinueOnly`
  (Harass).
- `handSize: number`, which adds to the combat frame's existing hand-size
  bonus for the card's player (Rumble). "Your hand size" means the
  Methuselah's, as with Rage of Apedemak.

Both are rush riders, so they apply only to the combat the card announced.
A blocked Rumble fights the blocker without the bonus. That's the
`rushRiders` reading from `rush-outcome-design.md` §2.

### 4.3 Two new end-of-combat payoffs

`OutcomeEffect` gains `readyGainsBlood`, used with `when:
"oneCombatantReady"`:

- `{ amount: 4 }` for Taunt the Caged Beast `[ANI]`.
- `{ opposingCapacity: true }` for Games of Instinct.

"That ready vampire" can be either combatant, including the target. The
card names no exception, which is the reading Abuse of Power took
(`rush-outcome-design.md` §3). The opposing vampire might have been burned
in the combat, so its capacity is read from its card, not from a live
minion. Blood over capacity goes back to the bank (p. 5), which the
engine's existing gain already does. The ready combatant must be a vampire.
If it's an ally, nothing is gained, because the card says "vampire".

### 4.4 Monomancy's end-combat option

This clause needs new engine work. During the rush combat, the TARGET is
offered an option that comes from a card that isn't in play.

- `actionEnterCombat` gains `opposingMayEnd: { statics }`, and the rush
  combat frame carries it as a rider.
- In `combat.beforeRange`, in round 1 only, the opposing minion's
  controller gets the option `endcombat:Monomancy:<cardInstanceId>`. It ends
  combat through the same helper that the equipment `burnToEndCombat`
  ability uses.
- The action card is held aside rather than burned, as Pillars Fall's card
  is. If the target takes the option, the card goes on the target with
  `statics.bleed: -1`. In every other case it burns when the combat ends.
  [RTR 20020501] then holds automatically, because only this option
  attaches the card.

The option id is a new built-in prefix, because `ability:` is for cards in
play. It joins the option-id list in `CLAUDE.md`.

### 4.5 The end-of-action tail

Rumble's "if this acting vampire is not ready at the end of the action" is
read at the end of the ACTION, not the combat. So it applies to a blocked
Rumble too: if the actor went to torpor fighting the blocker, you burn 1
pool. "Not ready" includes a burned actor.

`ActionFrame.atActionEnd` holds the riders that run when the action ends.
The delayed replacement draw moves onto the same list, which fixes D1 for
Bum's Rush. The five other pool cards that print "Do not replace until
after this action" move with it: Arson, Pack Tactics, Elder Intervention,
New Management and Baseball Bat. Where the tail runs depends on §5 Q2.

### 4.6 Taunt the Caged Beast `[ANI]`

The superior mode is an undirected action, because it prints no Ⓓ.

- **The gate.** The mode is offered only when the table has two other
  seats, so that predator and prey are different Methuselahs. It also needs
  a ready vampire on each side. Both vampires are chosen at announcement
  (p. 25) and ride in the option id.
- **The combat.** On success, the combat is queued through Hedonism's
  `queuedCombats`, which re-checks that both vampires are still ready. The
  prey's vampire takes the first slot (`cf.acting`), because it goes first
  [LSJ 20070319]. That slot sets the order only. Neither vampire is the
  acting minion of the action, and the actor of the action doesn't fight.
- **The payoff.** It's §4.3's `readyGainsBlood: { amount: 4 }`.

### 4.7 Requirements

Games of Instinct and Monomancy use `requiresSect: ["Sabbat"]` with the
existing ready check. Rumble uses `requiresSect: ["Sabbat"]`; its
requirement doesn't say "ready", but a torpid vampire can't act anyway.
Purity of the Beast uses `requiresVampire`.

## 5. Questions for the owner

**Q1. Big Game: admit it now, or wait for Red List minions?** Red List is a
trait (p. 41), and no V5 crypt card has it. The card's rush works in
today's pool, but its Red List branch can never fire. That branch needs two
new mechanics: a Red List trait check, and a single credit that can be
spent as a maneuver or as a press. A test can reach them only through a
made-up fixture minion.

- **Recommended: wait.** Build Big Game when §7 opens a group with Red List
  vampires, so that its new mechanics can be tested with real cards. The
  other six cards don't depend on it. Its replacement clause is fixed for
  Bum's Rush anyway (D1).
- **Alternative: admit it now**, with the branch built and tested on a
  fixture. It's whole, but half of it is dead code until §7.

**Q2. Where should a successful rush's combat run (D2)?**

- **Recommended: inside resolution.** Push the combat with the action frame
  still on the stack, which is where a blocked action's combat already runs
  (p. 27). The order becomes: the combat, then the after-resolution window,
  then the end-of-action tail. That fixes D1 and D2 together, and the tail
  has one place to run, `finishAction`. The cost is that every
  successful-rush trace test that expects Freak Drive before the combat
  changes. That ordering was wrong, so the tests were asserting the defect.
- **Alternative: keep the order, and fix only D1.** The tail rides on the
  rush combat frame and runs when the frame pops. Freak Drive keeps its
  current, early window.

A political action's referendum also runs after the window today. It's
outside this wave, and the question is recorded here only.

**Q3. Approve the readings in §4.** The readings that need approval are
the following:

1. One predicate re-reads every target term at resolution. A failed term
   fizzles the action, as the Ambush and Harass rulings describe (§4.1).
2. Rumble's hand-size bonus and Harass's press apply only to the rush's own
   combat, never to a block combat (§4.2).
3. "That ready vampire" can be either combatant, and an ally gains nothing
   (§4.3).
4. Rumble's pool burn also applies when the action is blocked (§4.5).
5. In Taunt `[ANI]`, the prey's vampire takes the first slot, and neither
   combatant counts as the acting minion (§4.6).

### 5.1 The owner's answers (November 3, 2026)

- **Q1: wait.** Big Game leaves this wave and is built when §7 opens a
  group with Red List vampires. The wave is six cards.
- **Q2: inside resolution.** A successful rush's combat runs with the
  action frame still on the stack, before the after-resolution window and
  the end-of-action tail. This fixes D1 and D2 together.
- **Q3: all five readings approved** as §4 describes them.

### 5.2 D3: two more "after action resolution" clauses (0.11.60)

The Q2 answer reached the window and the replacement draw, but not the
two other clauses that print "after action resolution". Both still ran
before a successful rush's combat:

- **The unlock offers** from `addAfterResolutionUnlock`: Paths in Two
  Worlds, Gifts From Hereafter, and every crypt `unlockAfterAction` (Aline
  Gädeke, Keegan, "Mother" Anja Giovanni and the rest). They were queued
  during resolution and flushed on top of the combat frame, so the offer
  was asked first.
- **Daring the Dawn's damage** (`afterResolutionDamage`). Applied before
  the combat, it could send the actor to torpor, and then the rush had no
  ready actor and started no combat at all.

The fix: when a rush combat starts, `resolveAction` holds both, and
`afterRushCombat` (the `settle` branch for `rushCombat`) runs them once
the combat is over, in the same order as the plain path: the damage, the
window, then the offers. Go-getter's rush skips them, because its action
already resolved as blocked and ran them then. Tests: the two D3 cases in
`tests/cards/hand-rush.test.ts`. The Anja union test in
`tests/cards/granted-action-requirements.test.ts` was pinning the old
order (Umbrous Clutch is a rush) and now expects the offer after the
combat. `afterRushCombat` is now `afterActionPayoff` (§5.3).

### 5.3 D4: the referendum is inside the political action (0.11.61)

The owner asked for the §5 Q2 note to be fixed. The rulebook settles it:
the glossary defines the referendum as "the part of a political action"
in which the terms are set, the votes cast and the effects applied
(p. 43), and p. 27 calls it as the action succeeds. So everything a card
prints for "after action resolution" or "after this action" comes after
the referendum, the same as after a rush's combat.

Before this fix, `finishAction` pushed the referendum after the action
frame had popped. That put the following ahead of the vote:

- **The after-resolution window** (Freak Drive and its family).
- **The D3 pair:** Daring the Dawn's damage and the unlock offers.
- **Warsaw Station's unlock** (`unlockOnSuccess`). D3 missed it, and it ran
  before a rush's combat too.
- **"Do not replace until after this action"** draws.
- **The end of every wake**, which lasts "for the duration of the action"
  (p. 44).

**The fix.** `callReferendum` pushes the referendum with the action frame
still on the stack, at the new step `referendum`. When it pops, `settle`
calls `afterActionPayoff`, which runs the D3 sequence: the unlock, the
damage, the window, the offers, then `finishAction`. Go-getter's continued
political action calls its referendum the same way, and afterwards it
only finishes, as its rush does. `referendumSourceOf` is the one place
that decides whether an action calls a referendum.

**Yawp Court needed its own window.** It prints "if a political action is
successful, BEFORE THE REFERENDUM". It used the after-resolution window,
which no longer comes first. So `beginReferendum` opens a new impulse,
`action.beforeReferendum` (step `beforeReferendum`), which is opened only
when some seat can use it, like the after-resolution window. The
referendum is called when that impulse closes. The ambush can't use
`queueCombat` any more, because a queued combat waits for the end of the
action. It uses a new `enterCombatNow`, which pushes the combat on top of
the action and hands the impulse back to the acting Methuselah (p. 8).

**Three more fixes the move required:**

- **Under the Skin superior** prints "lock that vampire at the end of the
  action if the referendum passes". It locked at the tally, which was the
  end of the action before this fix. The lock is now recorded on the action
  (`lockAtEndOfAction`) and applied in `finishAction`.
- **Delaying Tactics** (`barRepeatAction`) read the action first and fell
  back to the referendum. With the action frame now under the referendum,
  a referendum called from a card in play would have been keyed by its
  action kind. It now reads the referendum first, which keeps the old
  behaviour exactly.
- **Yawp Court ambushing your own vampire.** The ambush was offered on the
  location controller's own political action, and p. 28 says "your minions
  cannot enter combat with other minions you control". It's now refused in
  the option list and in `enterCombatNow`.

**What stays after the action.** Nothing now. A diablerie's blood hunt was
left after the action frame in 0.11.61 and moved inside it in 0.11.62
(§5.4).

**Tests.** Three new cases in `tests/cards/hand-rush.test.ts` (Freak
Drive, Warsaw Station and Under the Skin, each against the referendum).
In `tests/cards/crypt-and-uncontrolled.test.ts`, the two Yawp Court tests
now read the event log. The first one had been passing for the wrong
reason: the referendum had already finished, so no referendum frame was
on the stack. A new negative test covers the own-vampire case. All six
fail on 0.11.60 and pass on 0.11.61.

### 5.4 D5: the diablerie and its blood hunt are inside the action (0.11.62)

The owner's ruling (November 8, 2026) was to follow the rules. They're
clear on both points:

- **The diablerie is the action's effect.** p. 23, "Diablerise a Vampire in
  Torpor": "If the action is successful, the victim is diablerised."
- **The hunt is immediate.** p. 35: "a referendum is automatically and
  immediately conducted to determine if a blood hunt will be called". The
  same paragraph says that action modifiers and reaction cards can't be
  played in it, which only needs saying because it happens during an action.

**What was wrong.** Both the diablerie and the hunt waited for
`finishAction`, after the action frame popped. The reason was §2 of
`torpor-prey-design.md`: a frame pushed during resolution used to be thrown
away with the action. That stopped being true in 0.11.60, when a step that
waits (`rushCombat`, `referendum`) let resolution stop and resume. So the
after-resolution window, Warsaw Station's unlock, the replacement draws and
the end of every wake all came before the victim was even burned.

**The fix.** `commitActionDiablerie` runs straight after the success
effects in `resolveActionInner`, for the diablerise action and for a card's
"Ⓓ Diablerize a vampire in torpor" (`pendingDiablerie`). If it pushed a
hunt, the action stops at step `referendum`, and `settle` resumes it through
`afterActionPayoff`, the same path a political action takes. With no hunt
to call (Archon, Fueled by Heart's Blood), the action carries on as normal.
The check that the diablerist is ready (p. 34) now covers the card path as
well.

**Step 4 before the hunt.** `commitDiablerie` now pushes the hunt and then
raises step 4's master-Discipline search. Choice frames are a stack, so the
search is asked first, on every path. Step 4 is part of the diablerie, and
the Red List rule (p. 9) also places the diablerie's own payoffs "before the
blood hunt referendum is called". On the blocked-leave-torpor path the hunt
used to come first, and `tests/engine/diablerie.test.ts` recorded that
order; its trace now answers the search first.

**Unchanged.** Absolution of the Diabolist and Lay Low act in the hunt's
own after-resolution window, which doesn't depend on what is under it.

**Tests.** `tests/engine/diablerie-in-action.test.ts` has four cases. Two of
them fail on 0.11.61: the hunt polls with the action frame still under it,
and a wake lasts through the hunt. The step-4 ordering case passes on both
versions on this path, so it guards the order rather than proving a change.
The Archon case is the negative: no hunt, and the action still ends.

## 6. What isn't in this wave

- **Big Game** (§5.1, Q1).
- **Freak Drive** keeps its window, which now comes after a rush's combat
  (§5 Q2) and after a referendum (§5.3).
- **Allies that rush:** the second §8 family in
  `equipment-rush-design.md`.

## 7. Tests

`tests/cards/hand-rush.test.ts`, with a positive and a negative case for
every filter:

- **Targets.** Each card offers exactly its legal targets: never its own
  minions under `othersOnly`, never a younger or same-capacity vampire for
  Games of Instinct, never a non-Sabbat for Monomancy, never a vampire for
  Purity of the Beast, and never another seat's ally.
- **Harass.** The fizzle when the target gains blood and unlocks before
  resolution, and no fizzle when either term still holds. The press can
  continue the combat and can't end it.
- **Games of Instinct.** Either combatant gains: the actor when the target
  goes to torpor, and the target when the actor does. The capacity is read
  from a burned opponent. Blood over capacity returns to the bank.
- **Monomancy.** The option is offered to the target only, in round 1 only,
  and before range only. Taking it attaches the card with -1 bleed. Ending
  combat some other way burns the card.
- **Rumble.** The hand size is +1 during the rush combat, and the
  discard-down runs after it. The pool burn happens when the actor goes to
  torpor in the rush combat and when it goes to torpor fighting a blocker.
  There is no burn when the actor is still ready.
- **Taunt the Caged Beast.** The `[ANI]` mode isn't offered with two seats.
  The prey's vampire acts first. The 4 blood goes to the ready one, and
  nobody gains when both are ready.
- **The defects.** Bum's Rush draws its replacement after the rush combat
  (D1). Under Q2's recommendation, Freak Drive is offered after the rush
  combat, not before it (D2).
- **The fuzz.** All admitted cards join the fuzz decks, with a tally of
  what is actually offered.
