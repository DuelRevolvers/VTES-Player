# Victory points (wave 103)

Four legacy library cards that read, spend, move, or date a victory point
(VP). Before this wave, no card in the pool touched one: VPs were written
in three places and read only by the score.

| Card | Id | What it needs |
| --- | --- | --- |
| Momentum's Edge | 101237 | A play gate on VPs; a lock-for-pool in your unlock phase |
| Gambit Accepted | 100799 | Losing a VP; an oust clause, a withdrawal clause, and an end-of-game clause |
| Lextalionis | 101099 | When a VP was received, relative to the caller's last turn |
| Life Boon | 101103 | A window before an oust; taking another Methuselah's next VP |

Rulebook citations are to the V5 rulebook. Rulings are from KRCG's
snapshot in `data/vtes-raw.json`.

## 1. The oust window

Life Boon is played "to keep them in the game", so it needs a moment
between a Methuselah running out of pool and leaving the game. The engine
ousted in `processOusts`, a state check run whenever the turn frame
surfaces, with no decision in between.

`OustFrame` (`kind: "oust"`, window `oust`) is that moment. When some
standing seats have no pool, `processOusts` asks every seat, in
sequencing order from the turn seat, for options in the `oust` window. If
any seat has one, the frame is pushed with a cycle of those seats; when
the cycle is quiescent, settle pops it and ousts whoever still has no pool.
Because the frame's own resolution performs the oust, the window cannot
reopen for the same oust.

**Recorded deviation (the `combat.damageResolution` one):** the frame
opens only when some seat can play into it, and its cycle carries only
those seats. An ordinary oust asks nobody anything. The cost is that a
window opening tells the table that somebody holds a card for it.

## 2. One place a VP is awarded

`VtesEngine.gainVictoryPoint(seat)`, on `EngineOps`, is the only award.
The four existing award sites now call it:

- The predator of an ousted Methuselah (p. 37).
- The last Methuselah standing (p. 37).
- A successful withdrawal (p. 38). The `Withdrew` reducer used to add the
  point itself; it now only removes the seat, and `resolveWithdrawal`
  awards the point after it.
- Gambit Accepted's three clauses.

The award asks every card in play `claimsVictoryPoint` (Life Boon, §4),
then emits `VictoryPointGained`. The reducer stamps
`SeatState.lastVictoryPointTurn` with the turn number, so a replayed log
stamps it too. A receipt, not a balance: a point later spent on Gambit
Accepted was still received.

`VictoryPointLost` is the first event that takes one away.

## 3. Momentum's Edge and Gambit Accepted

Both are master-phase masters gated on "at least 1 victory point", read at
play. A Methuselah who later spends the point keeps the card.

**Momentum's Edge** is unique (`seatControlsCopy` for your own second
copy; `settleContests` for a rival's). In your unlock phase it offers
`ability:Momentum's Edge:<id>:lock`. The card unlocks in the sweep at the
start of the phase, so the lock is its own once-a-turn latch.

**Gambit Accepted** loses the point on resolution. A Gambit cancelled as
played (p. 16) never resolves and keeps it. Then:

- `onControllerUnlock`: move 1 pool from your prey to you. Not optional;
  the card says "move", not "may".
- `onSeatOusted`: your predator gains an additional point. It fires before
  the `Ousted` event, so "your predator" is the seat taking the ordinary
  point, even when that seat goes out in the same oust (p. 46).
- `onSeatWithdrew` (new hook): the same point when you withdraw, per
  [RTR 20040501]. Withdrawing is not an oust, so `onSeatOusted` stays
  silent and War of Ages does not fire.
- `onGameEnd` (new hook): if you have not been ousted, you gain a point.
  `endGame` fires it before `GameEnded` on both paths: the last Methuselah
  standing and the `maxTurns` safeguard. A withdrawn seat is marked
  ousted, so it never collects this point.

## 4. Life Boon

Offered in the `oust` window as `play:Life Boon:-:<seat>:<card>`, once per
seat that has no pool, to a holder who meets all of these:

- It is not the holder's turn (p. 8: never on your own turn).
- The holder has no out-of-turn master used since their last master phase.
- No boon bar is in play (Blood Trade's `barsBoons`; the spec declares
  `keywords: ["boon"]`).
- The holder can give enough and keep 1 pool.

**How much.** "Give pool" names no amount. The least is `1 − pool`: "the
Life Boon player must give her enough pool to compensate" for a negative
pool [RTR 19970630]. The most leaves the giver 1 pool, the line Archon
Investigation already draws ("never oust yourself"). When more than one
amount is legal, a choice frame asks for it
(`choice:Life Boon:<card>:amount:<n>`).

**In play** it records `PermanentInPlay.boonTarget`, which the table shows
as a "→ seat" badge on the card.

- **The steal.** In each of the debtor's unlock phases, the holder is
  offered `ability:Life Boon:<card>:steal` once (the phase latch).
- **The point.** `claimsVictoryPoint` takes the debtor's next VP for the
  holder, and the award burns the card. Several boons on one Methuselah
  "reserve a series of victory points" [RTR 19951017]; the award asks them
  in the order of their `CardPlayed` events, oldest first.
- **"Until you are being ousted."** A holder in the oust that earned the
  point takes nothing, so a boon on your own predator does not take the
  point for ousting you [RTR 20000501]. A withdrawn holder takes nothing
  either, because a withdrawn seat's cards stay on the table.
- **Only the point.** A debtor whose prey is ousted still gets the 6 pool
  [LSJ 20021029].
- **Withdrawal.** A debtor who withdraws gains a point by doing so, and the
  boon takes it.

## 5. What the wave found

**Two Methuselahs ousted at once were scored one at a time.** The FAQ
(p. 46) says "every Methuselah whose prey is ousted (even if they are
themselves ousted) gain 1 victory point, but only those Methuselahs that
survive the action will gain pool". `processOusts` ousted the first seat
with no pool, re-read the ring, and repeated. Two failures followed:

- A predator at 0 pool processed second had already been paid 6 pool for
  its prey, and survived. On Bob's turn with Alice and Carol both at 0,
  Carol scored Alice, took 6 pool, and stayed in the game.
- A predator processed first was gone when its own prey went, so that
  point passed to the next seat round. With Bob and Carol both at 0 on
  Alice's turn, Alice scored both and took 12 pool; Bob scored nothing.

`oustBatch` now reads every victim's predator before anybody leaves, fires
the oust hooks, ousts them all, and pays each predator its point, and the
6 pool only to predators that are not in the batch.

**A seat card used in another Methuselah's unlock window was credited to
the turn seat.** `useAbility` takes `owner.seat` from `currentSeatOfTop`,
and the turn frame answered with the turn seat even in the window it hands
to other Methuselahs ("during any Methuselah's unlock phase"). Life Boon's
steal therefore burned 1 of Bob's pool and gave it straight back to Bob.
`choose` now records the seat answering the decision (`chooser`), and
`currentSeatOfTop` returns it while that decision is applied. Every other
frame already agreed with the decision's seat, so only the turn frame
changes.

## 6. Lextalionis

New primitive `refLockSeatMinions` (polarity `other`; summary tag `deny`,
the `lockAllMatching` reading).

- **Terms.** `terms:<seat>` for each standing seat, the caller included,
  that `receivedVictoryPointSinceLastTurn` accepts. "Since your last turn
  means between the end of your last turn and now. Your last turn does not
  qualify, your current turn does" [LSJ 20020429]. `endTurn` stamps
  `SeatState.lastTurnEnded`; a point stamped on a later turn qualifies, and
  before the caller's first turn has ended, any point qualifies.
- **Play gate.** The card "cannot be used or played if the conditions for
  the terms of the referendum cannot be met" [LSJ 20100129], so the
  political-action enumerator asks the same helper before offering it.
- **Effect.** Lock every minion of the chosen seat and set the one-shot
  `skipNextUnlock` on each, including a minion that was already locked,
  because that clause is about the next unlock and not about this lock.
  Torpid vampires are included, the `refLockClan` reading.

## 7. The bots

Nothing in the bot policy knew the `oust` window, so a bot holding Life
Boon scored it like any master (2 against pass at 0.5) and would have kept
its own prey in the game. That throws away its own point and 6 pool.
`scorePlay` now refuses an `oust`-window play that saves the bot's own
prey, or that it cannot afford above its pool floor. The gift is not on
the option as a cost, so the floor check is made here.
`tests/ai/oust-window.test.ts` pins both sides. Gambit Accepted is scored
as an ordinary master; no precon carries any of the four cards.

## 8. Open questions for the owner

1. **Life Boon's ceiling.** The most a holder can give leaves them 1 pool,
   following Archon Investigation's "never oust yourself". The card names
   no limit, so giving your last pool is arguably legal and would oust
   you.
2. **Lextalionis and torpor.** "Lock all of his or her minions" includes
   vampires in torpor, which then cannot attempt to leave torpor next
   turn. The alternative is ready minions only.
3. **Gambit Accepted at the safeguard.** The `maxTurns` draw is treated as
   the end of the game, so a Gambit controller still in it gains the
   point. It is an engine safeguard, not a rule, so either reading is
   defensible.
4. **The oust window's information leak.** It opens only when somebody
   can use it (§1). The alternative is to ask every seat at every oust.
