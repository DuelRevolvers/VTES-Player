# Choice Frames — "the card asks one Methuselah a question"

Status: **IMPLEMENTED** (2026-08-03). Owner asked for the hardest
mechanism first. Built: the frame, the two handler hooks, `raiseChoice`,
the `onControlChanged` and `onDiscard` hooks, `PermanentInPlay.chosen`,
`drawCards`, and discard-without-replacement. Cards: **The Rack** (101536),
**Fragment of the Book of Nod** (100785), **Powerbase: Los Angeles**
(101435); plus the two auto-taken-optional deviations retired (Cave of
Apples, Dead Pool). Tests: `tests/cards/choice-frames.test.ts`,
`tests/cards/powerbase-la.test.ts`.

**Implementation note not in the draft:** a choice raised from inside
`resolveAction` was popped by the action's own `pop()`, leaving the action
frame stuck and the settle loop spinning forever (it OOM'd the test
worker). §3 predicted the hazard; the fix is a deferral queue —
`raiseChoice` queues while an action resolves, and the queue is flushed in
a `finally` once the action frame and anything it pushed are settled.

---

## 1. The problem

Several cards need the engine to stop and ask exactly one Methuselah a
question that is **not** an action, **not** a card play, **not** a
referendum, and **not** a phase window:

- "As this location is played **or its controller changes**, its
  controller chooses a ready vampire they control" — The Rack (101536)
- "Lock this card to draw 2 cards **(discard down afterward)**" — Fragment
  of the Book of Nod (100785)
- "**You can** burn those counters to steal that minion" — Cave of Apples
  (100311), currently auto-taken (a noted deviation)
- "**You can** add a counter" — Dead Pool (102299), same deviation

Today the engine can only ask a question in four ways: an action's option
list, a card play's params (fixed at announcement, p. 25), a referendum's
terms step, or `DiablerieOfferFrame` — a bespoke frame built for one
question. That last one is the precedent this generalizes: rather than a
new frame type per card, one frame that any card can raise.

Worth stating plainly: **two of the deviations I have been accumulating
are the same missing mechanism.** Building it retires them instead of
adding a third.

## 2. The frame

```ts
export interface ChoiceFrame {
  kind: "choice";
  /** Who answers. Only this seat decides; no impulse cycle (§3). */
  seat: SeatId;
  /** The card that raised the question — dispatch target. */
  cardName: string;
  cardId: CardInstanceId;
  /** Which question, for cards that raise more than one. */
  key: string;
  /** Context fixed when the question was raised. */
  params: Record<string, string>;
  /** "You can …" → a decline option is offered. "Choose a …" → no
   *  decline; if nothing is choosable the frame pops with no effect. */
  optional: boolean;
}
```

Handler surface, mirroring `abilityOptions`/`useAbility`:

```ts
choiceOptions?(frame: ChoiceFrame, state: GameState): LegalOption[];
applyChoice?(frame: ChoiceFrame, choice: LegalOption, ops: EngineOps): void;
```

One op: `raiseChoice({ seat, cardName, cardId, key, params?, optional })`.

Option ids follow the existing conventions:
`choice:<Card>:<cardInstanceId>:<key>:<value>`, plus `pass` when optional.

## 3. Sequencing

A choice is **part of a card's own resolution**, not an action: no impulse
cycle, no window for anyone else, answered immediately by the one seat.
This matches how the diablerie offer already behaves and keeps the rule
simple — nobody gets to respond to "which vampire did you pick".

If `choiceOptions` comes back empty, the frame pops and nothing happens —
the same rule already used for "a referendum whose terms have no legal
choice passes with no effect".

Frames raised during a resolution land on top of the stack and are
answered before the raising context continues. Where a card raises a
choice from inside `resolveAction`, the frame is pushed after the action
frame pops (the diablerie precedent), so the question is asked with a
clean stack.

## 4. Two supporting pieces

**`onControlChanged` hook** — The Rack's trigger is literally "or its
controller changes". The `ControlChanged` event fires the new controller's
copy of the handler, which raises its choice.

**`PermanentInPlay.chosen`** — "the chosen vampire" is referenced by a
*later* clause on the same card (The Rack's unlock-phase 2 blood), so the
answer has to persist on the entry. Also what Toreador Grand Ball and
Priority Contract will want.

**`drawCards(seat, n)` and discard-without-replacement** — Fragment draws
2 *extra* cards (not replacements), then discards down. The existing
`discardCard` always draws a replacement, which is right for the discard
phase and wrong here, so it takes a flag.

## 5. Wave

| Card | What it exercises |
| --- | --- |
| **The Rack** (101536) | a choice at play **and** on control change (`onControlChanged`), persisted in `entry.chosen`, consumed by a later unlock-phase clause; plus the `steal` outcome from the control-change gate |
| **Fragment of the Book of Nod** (100785) | a *repeated* choice (discard down while over hand size) and extra draws; also stealable |
| **Cave of Apples** (100311) | retires the auto-taken-steal deviation — the threshold now raises a real optional choice |
| **Dead Pool** (102299) | retires the auto-taken-counter deviation |

## 6. Judgement calls

1. **No impulse cycle around a choice** (§3). A choice is not a card play,
   so there is no as-played window and nothing to respond to. If a future
   card wants an interruptible choice, that is a different frame.
2. **The Rack's choice when control changes mid-action.** Control moves at
   action resolution, so the new controller answers immediately after the
   stealing action resolves, before play continues. That is the earliest
   coherent point; the card just says "as … its controller changes".
3. **Discarding down is forced but the *pick* is free** — the frame is
   non-optional and re-raised until the hand is legal, so a player cannot
   sit above hand size, but chooses which cards go.
4. **Fragment's lock ability is offered only during its controller's own
   turn phases.** The card prints no timing restriction, so "any time"
   (including other Methuselahs' turns, as The Barrens is ruled) would be
   more faithful; noted deviation.
5. **Powerbase: LA's "that discard phase action"** — the card grants a
   second action but does not say which of the two is "that" one, so any
   discard made this phase after the location is locked qualifies. Its
   "or making a vampire Anarch" half needs a sect-change vocabulary the
   engine does not have (sect change is out of scope per CLAUDE.md), so
   only "requiring an Anarch" is detected.

## 7. Tests

Kernel: a raised choice asks only the named seat and offers no options to
anyone else; an optional choice can be declined; a non-optional choice
with nothing to pick pops harmlessly; `applyChoice` sees the params fixed
at raise time. Cards: The Rack picks at play, re-picks for the thief after
a steal, and feeds only the chosen vampire; Fragment draws 2 and forces
discards down to hand size with the player choosing which; Cave of Apples
now *offers* the steal and honours a decline; Dead Pool likewise.
