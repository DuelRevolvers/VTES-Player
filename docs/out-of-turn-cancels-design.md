# Out-of-turn cancels — wave 99

Six T1 masters built on one machine, the as-played cancel that Sudden
Reversal (V5) already uses: `cancelPendingCard` on the `cardPlay` frame.

| Card | Cost | Cancels | Then |
|---|---|---|---|
| Direct Intervention | 1 | a **minion card** | — |
| Dark Influences | 2 | a **minion card** | goes into play: bans that card name this turn, and shields the next minion-card cancel |
| Not to Be | 1 | an **event** | goes into play: +1 master action in your master phase, −1 discard action in your discard phase, then burns |
| Emergency Preparations | 0 | a **Gehenna card** (burn 1 pool) | *or*, in your minion phase with 2+ Gehenna cards in play, unlock a vampire with capacity above 7 |
| Wash | 0, trifle | a **master** played by your predator or prey | that Methuselah gets +1 master action, now or next master phase; Wash is not replaced until your unlock phase |
| Personal Involvement | 3 | — (it is the one cancelled) | prey burns 3 if richer than you; **any** Methuselah may burn 2 pool to cancel it, refunding its cost |

## §1 Rules read (V5 rulebook)

- **p. 7** — only cancels and wakes may be used in another card's as-played
  window. That partition is what §4 leans on.
- **p. 9** — an out-of-turn master is played only during **another**
  Methuselah's turn, uses a master action from the next master phase *even
  if cancelled*, and you cannot play a second one before that phase. An
  **out-of-turn trifle** gains its master action in the **next** master
  phase; only one trifle gain per master phase.
- **p. 16** — "A cancelled card has no effect, but it is still considered
  played." A cancelled action card does not lock its minion; a cancelled
  non-action card's cost is paid unless the card says otherwise; a
  cancelled strike is re-chosen.
- **p. 43** — *Minion Card: any library card that is not a master, or
  event card.*
- **Golden Rule (p. 16)** — Emergency Preparations' "you may play this card
  during your minion phase" overrides p. 9's own-turn bar for that mode
  only. It is still an out-of-turn master, so it still spends next master
  phase's action and still counts as the one out-of-turn master.

Rulings applied: a cancelled card's own "do not replace until" clause is
cancelled with it and the card is replaced normally [LSJ 20080630]; Wash
cancelling a trifle gives no trifle bonus, and the master action Wash
gives is not a trifle bonus [ANK 20170124]; Wash on an out-of-turn master
does not restore that seat's out-of-turn budget [LSJ 20070309-2].

## §2 Frame additions (the `isMaster` treatment)

Stamped on `CardPlayFrame` at push, so no card reads another card's spec:
`isEvent`, `isGehenna`, `isOutOfTurnMaster`, `cancels` (this play is
itself a card cancelling the play beneath it), and `heldReplacement`
(where its replacement draw was held, §5). "Minion card" is
`!isMaster && !isEvent` — one helper, `isMinionCardPlay`.

"Gehenna card" was spelled inline as `permanentTags.includes("gehenna")`
in `playCard`; it is now `isGehennaCard(handler)`, read by both that
site and the frame stamp.

## §3 One factory for the out-of-turn cancels

`outOfTurnCancel({...})` in `cards.ts` builds Sudden Reversal, Direct
Intervention, Dark Influences, Not to Be, Wash and Emergency Preparations'
cancel mode. Sudden Reversal moved onto it, so the six cannot disagree
about the p. 9 gate (`outOfTurnOpen`: budget unspent, not your own turn),
about "never oust yourself" (pool must exceed cost plus any pool the
cancel burns), or about `pending.canceled`.

## §4 Dark Influences' shield — what "a card that cancels" is

*"The next card played that would cancel another Methuselah's minion card
as it is played is canceled, its cost is not paid, and this card is
burned instead."*

The engine had no notion of a card that cancels. Handlers now declare
`cancelsAsPlayed(mode)`: the factory sets it, Hide the Mind sets it, and
compiled combat cards derive it from a mode holding `cancelStrikeCard` or
`cancelCombatCard`. It is stamped on the new frame as `cancels`.

**It is enforced, not trusted:** `cancelPendingCard` throws if it is
called from a card's `resolve` and that card's frame is not `cancels`. Every
existing cancel card has a scenario test that reaches that call, so a
missed declaration fails the suite instead of shipping a hole in the
shield.

The shield fires as the cancelling card's frame is **pushed**, before
anyone can answer it. Firing at the cancel's resolution instead would let a
Sudden Reversal on the cancelling card pre-empt the shield, so Dark
Influences would survive when the text says it burns.

Readings taken (1 confirmed and 2 ruled by the owner, 2026-10-06):
1. **"That card cannot be played again this turn"** is the card NAME, for
   every Methuselah, for the rest of the turn. The cancelled copy is in
   the ash heap (§5), so the clause only means anything as a name. It
   overrides p. 16's "can play the same action card again". Held on the
   turn frame (`barredNames`) and applied in `handlerOptions`, the one
   place hand and store plays are enumerated.
2. **One** Dark Influences answers the next cancel and burns; any other
   copy stays in play for the cancel after it. The first in play order
   (`allEntries`) is the one that burns. *Owner ruling 2026-10-06, which
   reversed the first reading, under which every copy burned.*
3. Abilities of cards in play that cancel (Sword of the Archangel, a lock
   ability) are not "a card played", so they do not trip the shield.

## §5 Engine defects this wave found

1. **A cancelled card vanished.** `resolveCardPlay`'s cancelled branch
   emitted `CardCanceled` (which no reducer reads) and filed the card
   nowhere: not the ash heap, not the hand. p. 16 says it is still
   played. It now goes to the ash heap, action cards included. That is
   what "can play the same action card again" means: another copy.
2. **A cancelled card's held replacement was never released.**
   `scheduleReplacement` holds the draw at play time. A cancelled
   `afterResolve` card (Deal with the Devil) drew nothing, a cancelled
   Dodge waited for combat's end, and a cancelled `whileInPlay` Gehenna
   event waited forever for a card that never entered play.
   `scheduleReplacement` now returns where it held the draw, recorded on
   the frame. The cancelled branch takes it back and replaces normally
   [LSJ 20080630]. Only the card's OWN clause is released: Consign to
   Oblivion's "until the end of the action" is a rule about the action,
   and the card was still played into it.
3. **An out-of-turn trifle's master phase action was lost.** p. 9 says
   it arrives "in their next master phase", but the only trifle branch
   asked for a running master phase as the PARENT frame. An out-of-turn
   trifle never has one: Wash resolves inside another card's as-played
   window. So the gain went to nobody, silently, and was unreachable until
   Wash, the pool's first out-of-turn trifle. It is now booked on
   `trifleNextMaster` and counts as that phase's one trifle gain. The
   in-phase branch also names the seat now (`parent.seat === cp.seat`).
   That was not a live bug, but "a trifle resolved during a master phase"
   with no seat in it is the shape that becomes one.

## §6 New engine surface

- `EngineOps.gainMasterActions(seat, n, when)` — `"now"` adds to the
  running master phase if it is that seat's turn; `"next"` books it on
  `SeatState.masterActionsNext`, read and cleared as that seat's master
  phase opens. Wash uses both; Not to Be uses `"now"` from `onMasterPhase`.
- `payToCancel.seat` may be `"any"`, and `refundsCost` covers Personal
  Involvement's "(the cost of this card is not paid in that case)". The
  payer is the seat that took the option. `harms` names the seat the card
  would hurt, if it would hurt one, so a bot can tell whether it is
  paying for itself.

## §7 The bots

`PlayerView.pendingCard` (name, seat, minion, kind flags) is projected
like `action`/`combat`. The card is face up as it is played, so this is
open information. A bot no longer plays a cancel (`deny`) on its own card,
never pays to cancel its own card, and pays to cancel a card that names a
victim only when the victim is itself. Before this, nothing in the
policy could tell whose card was on the stack. Hide the Mind could already
have cancelled its own player's combat card.

## §8 Tests

`tests/cards/out-of-turn-cancels.test.ts`: each card's positive case, plus
the negative space — not on your own turn; not a second out-of-turn
master; Direct Intervention not on a master or event; Wash not on a
non-neighbour; Emergency Preparations' unlock mode under two Gehenna cards
and on a capacity-7 vampire; the shield not tripped by a master cancel or
by cancelling your own card. Also the three defects: the ash heap, the
released replacement, and the trifle seat.
