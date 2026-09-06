# Lock-to-grant locations — design

Five Master locations of the shape **"you can lock this card to give
someone +N something"**. The `permanent.lockGrant` mechanic already exists
(docs/clan-sect-design.md §4) and carries eleven cards; these five need
four new knobs on it, one additive engine hook, and one bug fix that the
wave uncovered.

| Card | id | The clause that is new |
|---|---|---|
| Kumpania | 101068 | "…a Ravnos **with capacity 5 or more** you control" |
| Channel 10 | 100327 | "**Not usable during the first action in a minion phase.**" |
| KRCG News Radio | 101067 | "…and **burn 1 pool** to give a minion controlled by **another Methuselah** +1 intercept" |
| The Anarch Free Press | 100052 | "**after an Anarch successfully hunts**, add 1 blood to that Anarch" |
| The Black Throne | 100172 | "after a minion **with a contract** for which an Assamite you control is chosen **leaves the ready region**" |

Each of the four also has a plain first clause that the existing compiler
already handles, so the wave is: one small addition per card.

## 1. `lockGrant.minCapacity` — Kumpania

> Unique. Put this card in play. You can lock this card to give a Ravnos
> with capacity 5 or more you control +1 intercept.

One filter beside the existing `clan`/`sect` ones. It reads capacity
through **`capacityOf()`**, not `m.capacity`, because capacity is a
derived trait now (docs/derived-traits-design.md): a Ravnos at printed
capacity 4 carrying a Discipline master that grants +1 capacity **is** "a
Ravnos with capacity 5 or more". `permanent.attach.minCapacity` already
made the same choice.

## 2. `lockGrant.notFirstMinionAction` — Channel 10

> Unique location. You can lock this card to give a minion you control +2
> intercept. Not usable during the first action in a minion phase.

Nothing in the engine could answer "is this the first action of this
minion phase?", so this is the wave's one piece of new state:
**`TurnFrame.minionActionsThisPhase`**, optional (existing fixtures are
untouched, `undefined` reads as 0).

It is incremented in exactly one place — `applyToFrames`, on
`ActionAnnounced`, when the turn frame is in the minion phase. There are
three separate announce sites in the engine (card actions, built-in
actions, granted actions from cards in play) and incrementing at each
would be three chances to drift out of step; reacting to the event covers
all three by construction and any future fourth.

The counter is incremented **at announcement**, so during the first action
it reads exactly 1, and the restriction is `minionActionsThisPhase <= 1`.
No reset is needed: a `TurnFrame` is created per turn and passes through
the minion phase once.

**Readings on record, both from the plain text rather than a ruling:**

- A first action that is **blocked, cancelled or otherwise fails still
  counts**. The card says "the first action in a minion phase", not "the
  first successful action" — announcing an action is what makes it an
  action taken (p. 27, announcement is step 1 of the action).
- An action announced **outside** a minion phase (a granted action during
  someone's unlock or influence phase) does not count toward it, because
  the clause is scoped to a minion phase. The counter simply is not
  incremented then.

## 3. `lockGrant.otherMethuselah` — KRCG News Radio

> You can lock this card to give a minion you control +1 intercept. You
> can lock this card and burn 1 pool to give a minion controlled by
> another Methuselah +1 intercept.

Two clauses over the same lock, distinguished only by *whose* minion is
being helped and whether a pool is burned. So `otherMethuselah: {
poolCost }` emits a **second option** from the same `lockGrant`, offered
when the blocking minion belongs to someone else and the location's
controller can pay.

Note what this is not: it is not a new targeting system. The blocking
minion is already fixed by `ctx.blockAttempt` — the card does not choose
who blocks, it pays to help whoever is blocking. The controller of the
location gets an impulse in that window like everyone else, so the option
appears exactly when it should.

Helping another Methuselah block is a real play (your predator's action is
your problem too), so the option is worth enumerating rather than
suppressing as never-useful.

## 4. `onHuntSuccess` — The Anarch Free Press

> Unique. Requires a ready Anarch. Put this card in play. You can lock
> this card to give an Anarch you control +1 intercept. You can lock this
> card after an Anarch successfully hunts to add 1 blood to that Anarch.

The second clause needs a hook that does not exist. `onBleedSuccess` is
its exact mirror and is fired from the bleed branch of action resolution;
`onHuntSuccess` is fired from the hunt branch three lines away, with the
same `{ actingMinion, actingSeat }` shape.

"Successfully hunts" means the hunt action resolved — a blocked hunt never
reaches that branch, so the hook is correct by placement rather than by a
condition.

The clause is a **lock-and-choose**, not automatic: the card says "you
*can* lock this card", so the hook does not act. It records that a hunt
just succeeded, and the ability is then offered in the same window. The
simplest honest shape, and the one used here, is for the hook to raise the
grant directly as an optional ChoiceFrame asked of the location's
controller — one seat, one question, no impulse cycle, which is what
`ChoiceFrame` is for (docs/choice-frames-design.md).

## 5. The Black Throne — the contract clause

> Unique location. You can lock this card during the polling step of any
> referendum to get +2 votes. You can lock this card after a minion with a
> contract for which an Assamite you control is chosen leaves the ready
> region to gain 1 pool.

The first clause is the existing `lockGrant: { grant: "votes", amount: 2 }`
verbatim.

The second is bespoke, and every piece it needs already exists: the
`"contract"` tag (Priority Contract carries it), `PermanentInPlay.chosen`
(the Assamite the contract names), and the `onLeaveReady` hook. The
condition is read strictly:

- the departing minion carries a card in play tagged `contract`; **and**
- that card's `chosen` minion is a Banu Haqim vampire; **and**
- that vampire is controlled by the Black Throne's controller.

**The V5 pool contains exactly one contract card** (Priority Contract), so
this clause is narrow today, but it is written against the tag rather than
the card name — the same choice Wall Street Night made for investment
cards, which have no referent in the pool at all.

## 6. `requiresControlledSect` / `requiresControlledClan`

"Requires a ready Anarch" on a Master card is a condition on the
**Methuselah**, not on a minion: you must control a ready Anarch to play
it. `requiresControlledTitle` already exists for exactly this shape
(Malkavian Justicar and friends) and these two are its siblings.

Six masters in the pool need them — The Anarch Free Press, Black Forest
Base, Carfax Abbey, Papillon, Piper, Yawp Court — so the other five become
data once their own clauses are written.

## 7. The bug this wave found — "Assamite" is not a clan the engine knows

Ten V5 library cards and two crypt cards still print the legacy clan names
**Assamite** and **Follower of Set** in their card text. The registry —
and therefore `cardinfo.ts` today and the phase-7 crypt importer
tomorrow — uses the modern names: **Banu Haqim** and **Ministry**. The
registry's fourteen clan names are the only vocabulary a `MinionState.clan`
will ever hold.

Every card that needed the translation got it right, with a comment,
except one: **Priority Contract filters `m.clan === "Assamite"`**, which no
imported vampire will ever match. It is marked supported and its test
passes, because the test fixture hand-sets `clan = "Assamite"`.

This is the same shape as the `meetsRequirements` bug: a filter that is
too narrow, asserted by nothing, invisible to the fuzz (which plays
whatever it is offered — an option list that is empty for the wrong reason
looks exactly like one that is empty for the right reason).

Fixed, and guarded by `tests/cards/clan-vocabulary.test.ts`, which scans
the card sources for clan-literal comparisons and asserts every one of
them is a name the registry actually uses. That catches the next legacy
name and plain typos alike.
