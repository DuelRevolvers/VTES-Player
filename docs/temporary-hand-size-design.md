# Temporary hand size — Dreams of the Sphinx and Rage of Apedemak

**Two cards, one gap, and the rulebook rules one of them by name.** Both
are already marked supported with a row in `docs/partial-support.md`
saying the same thing: *"temporary hand-size bonuses are unmodelled —
hand size is read only at discard"*. This closes both rows.

| Card | id | The clause |
|---|---|---|
| **Dreams of the Sphinx** | 100588 | "You can lock this card to get **+2 hand size until the end of the turn**." |
| **Rage of Apedemak** | 102336 | "**This combat**, you get **+1 hand size** and this vampire's hand strikes inflict +1 (sup: +2) damage." |

## 1. What the rulebook says

**p. 7, Drawing Cards** — the standing rule, and the half that was
missing:

> The number of cards in your hand should always match your hand size
> (cards that are replaced later reduce your hand size for the duration
> of the effect). The starting default hand size is seven cards in hand.
> **Whenever an effect changes your hand size** or adds or removes cards
> from your hand, **immediately discard down to or draw up to match your
> hand size.**

`handSizeOf` has always been the *read*; `reconcileHandSize` has always
been the *draw up*. **Nothing in the engine has ever discarded down
because a hand size fell** — the one existing discard-down is Telepathic
Vote Counting's, which fires because a card came *back* to the hand, not
because the size moved.

**p. 50, the rulings section, Dreams of the Sphinx** — and this settles
the two questions the clause would otherwise leave to a reading:

> If you use it during your turn to increase your hand size, **you first
> have the option of using a discard phase action to discard a card (and
> replace it) before decreasing your hand size back to normal by
> discarding 2 cards.** If another Methuselah plays Dreams of the Sphinx
> to contest yours, you cannot lock it "right before it enters the
> contest".

So:

1. **The expiry really does cost you the cards.** "+2 hand size" is a
   dig, not a gift: you draw 2 now and discard 2 when it lapses. A
   version that let the bonus expire silently would be a free two-card
   draw every turn, which is not the card.
2. **The expiry lands AFTER the discard phase.** The discard phase action
   comes *first* ("discard a card and replace it"), and *then* the
   hand-size decrease takes 2. That is a genuine ordering constraint, and
   §3 shows it falls out of putting the expiry at end of turn rather than
   needing a rule of its own.

The contest clause is not modelled: cross-player uniqueness contests are
a recorded out-of-scope deviation (CLAUDE.md), and nothing here changes
that.

## 2. Where the bonus lives — derived from a live frame, never stored

The obvious build is a counter on `SeatState` with an expiry someone
clears. **The retainer wave already rejected that shape** for the same
reason it is rejected here (`docs/retainer-wave-design.md` §1): a
combat-scoped effect on a hand size ends when the combat ends, and a
combat ends by a strike, by a card, by a combatant leaving play, or by
the frame being popped — *a flag that must be cleaned up at all of them
is a flag that will one day survive one of them.*

So a grant is a record on the frame whose lifetime it already shares, and
`handSizeOf` sums the live ones on every read:

```ts
export interface HandSizeGrant {
  seat: SeatId;          // whose hand size — not necessarily the turn seat
  amount: number;
  cardName: string;      // for the discard-down question's label
  cardId: CardInstanceId;
}
```

- **`TurnFrame.handSizeBonus`** — "until the end of the turn". `endTurn`
  *replaces* the turn frame outright, so the bonus lifts itself.
- **`CombatFrame.handSizeBonus`** — "this combat". The frame pops
  however the combat ended, so the bonus lifts itself.

Both fields are **optional**, the `idSeq` precedent: every existing
fixture and saved log is untouched.

`handSizeOf` already walks `state.frames` (it does so for Raptor's
`opposingHandSizePenalty`), so this is one more term in a loop that
exists, not a new derivation.

**The grant is keyed by SEAT, not by the frame's owner.** Dreams prints
no timing restriction, so a Methuselah may lock it during somebody else's
turn to dig for a reaction — a real play pattern, and one the turn frame
holds perfectly well, since "until the end of the turn" means the turn
that is happening.

## 3. The expiry — the only part that needs code

A frame going away emits no event, so p. 7's "immediately discard down"
has to be run at the two places a grant can lapse. Both already exist and
both are already the *after the pop* site:

- **`endTurn`**, after the turn frame has been replaced. The turn order
  is unlock → master → minion → influence → discard, so end of turn is
  after the discard phase — which is **exactly the ordering p. 50
  requires**, with no rule of its own.
- **beside `notifyCombatEnded`**, after the combat frame has been popped.
  Every combat exit funnels through that one site (there is a single
  `CombatEnded` emit in the engine), which is what makes the derived
  model safe.

Reading the grant *before* the frame goes and raising the question
*after* it has gone matters: `handSizeOf` must already exclude the bonus
when the "are you over?" test runs.

## 4. The discard-down is ENGINE-OWNED, not card-owned

Every `ChoiceFrame` so far is answered by a card handler
(`handler(frame.cardName).choiceOptions/applyChoice`). This one is
answered by the engine, and the reason is that **p. 7 is a rule of the
game, not a clause of either card**. Dreams is a bespoke handler and Rage
of Apedemak is pure `compileSpec`, so a card-owned discard-down would be
written twice — in a hand-rolled `choiceOptions` and again in
`compileSpec`'s `choiceByKey` — and *one question answered in two places,
where only one of them learns about a new case*, is precisely how
`modifyVotes`/`restrictVotes`, the two after-resolution probes and the
Scalpel Tongue enumeration all drifted.

So `key === "handSizeDown"` is intercepted ahead of the handler lookup,
at the one helper all three dispatch sites now call (options, apply, and
the empty-list pop in `settle`). The frame still carries the granting
card's name, purely so the question reads as English and the option id
keeps the documented shape.

It is a **repeated, non-optional** frame — one card at a time, re-raised
until the hand matches — which is the `unlockToll` shape, for the same
reason: each answer changes the board the next option list is computed
against. The re-raise is safe because `choose()` already **pops before
calling apply**, and the comment there already anticipates "the
discard-down loop".

**`replace: false`.** A discard-down is not a cost and not a play: the
hand is *above* its size, so nothing is drawn back. This is the sharp
edge the unlock-tolls wave found — a *cost* discard IS replaced (p. 7
does not care why the card left), a *discard-down* is not, and the two
look identical in code.

## 5. Readings on record

- **Dreams' hand-size ability is offered in every window its controller
  has an impulse in** — `turn.master` / `turn.minion` / `turn.discard`
  on their own turn, and `action.announce` / `action.effects` on anyone
  else's. The card prints no timing restriction, and `turn.*` windows ask
  only the turn seat (the Szczecin lesson), so the action windows are how
  a seat reaches it during an opponent's turn.
- **The lock still adds a counter and still burns the card at 3.** It is
  the same "each time you lock it" clause the other two abilities feed,
  so nothing about the third is special.
- **Rage of Apedemak stays classified as self-targeting.**
  `frenzyTargetSide` reads an allowlist of opponent-targeting effects, so
  a new primitive leaves the answer alone — the card buffs its own
  player, which is why a Tranquility Shield cannot stop it (recorded in
  `docs/round-recurring-combat-design.md`).
- **A grant whose seat cannot draw simply gets nothing**: an empty
  library draws no cards (p. 7), and the expiry's "are you over?" test
  then finds nothing to discard. The bonus is not a debt.
