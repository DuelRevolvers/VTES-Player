# Auctions for control (wave 105)

Wave 105 adds three masters that sell a card in play to the highest bidder:

- **Hostile Takeover** (100939)
- **Malkavian Time Auction** (101158)
- **Temptation of Greater Power** (101955)

They share one auction with Extremis Boon (wave 104, `docs/boons-design.md`
§5), which built the first one. Version 0.11.43.

## §1 The family

A text search of the unbuilt T1 cards for "bid" finds exactly these three.
None is inert:

- Hostile Takeover needs a vampire of capacity 6 or less. Most of the V5
  crypt qualifies.
- Malkavian Time Auction needs any card you control.
- Temptation of Greater Power needs a ready justicar. The V5 crypt has one
  (Kasim Bayar), and the Justicar title cards make more.

## §2 One auction for four cards

The bidding rule lives in one place in `cards.ts`, the `AuctionRules`
interface and five helpers (`startAuction`, `runAuction`,
`nextAuctionBidder`, `auctionOptions`, `auctionAnswer`). Extremis Boon now
uses them too, so the bidding rule cannot drift between the four cards.

The auction is a chain of choice frames:

1. The bidders are asked in a fixed order.
2. Each bidder raises or passes. A pass is final.
3. The auction ends when nobody left can top the high bid.

The frame carries the order, the seats that passed, the high bid, the leader
and each bidder's highest bid (`bids`). The card supplies four things: the
opening bid, the most each seat may bid, each bid's label and bot params,
and what the result does (`settle`).

| Card | Who bids, in what order | Most a seat may bid | Who is paid |
| --- | --- | --- | --- |
| Extremis Boon | Every other seat, from the victim's prey | Pool − 1 (the Life Boon line) | The victim |
| Hostile Takeover | Every seat, from the player | Pool; the controller 2 × pool | The controller, or the bank for half if the controller wins |
| Malkavian Time Auction | Every other seat, from the player's prey | Pool | The player, by the top two bidders |
| Temptation of Greater Power | Every seat, from the player | Pool + 5 | The bank, partly on credit |

"To your left" is your prey (p. 15), so every order runs prey-ward.

## §3 Hostile Takeover and Malkavian Time Auction

**Hostile Takeover.** "The player who played the card conducts the auction"
[LSJ 19990104], so the player bids first. "The controller … can bid up to
twice their current pool total, while other Methuselahs can bid up to their
pool total" [LSJ 19990825], because the controller pays only half, rounded
up, to the bank. A vampire in torpor is still a vampire in play.

**Malkavian Time Auction.** "You do not participate in the bid"
[LSJ 20030604]. The runner-up pays their best bid too, for nothing. Every
raise tops the last one, so the runner-up's best bid is the highest bid that
is not the winner's. "A card you control" means everything
`cardsControlledBy` returns:

- Your minions.
- The cards on them.
- Your own permanents.
- Anything you control on another seat's minion, such as a master you played
  there (p. 9).

A vampire's own ability entry is the vampire, not a second card.

"Requirements do not apply when taking control of a card already in play"
[TOM 19960226-1]. "If an equipment, retainer or location on a minion changes
controller, the new controller chooses a new target they control for them"
[LSJ 20030606]. That choice is a mandatory choice frame (`bearer`). Any other
card on a minion, such as a master, changes controller and stays where it is.

Taking control of a vampire is `takeMinionControl`, which also ends any loan
the vampire was on (`controlRevertsTo`). A permanent take supersedes a
borrowing.

## §4 Temptation of Greater Power and the debt

"Methuselahs may be credited up to 5 pool on the bid" lets a bid run 5 past
the bidder's pool. The **winner** chooses how much to owe: at least what
their pool cannot cover, and at most 5. The options list the most credit
first.

The debt is `SeatState.poolDebt`, changed only by the `PoolDebtChanged`
event. It sits on the seat because the card is in the ash heap by the time
the debt is paid. The engine collects 1 pool as the debtor's discard phase
opens. The payment is mandatory, and it can oust a debtor on 1 pool. The seat
header shows the debt as an "owes N" badge, and the log narrates each change.

"Only 1 Temptation of Greater Power can be played in a game" is
`oncePerGameByName`, read off the event log. "Requires a ready justicar" is
`requiresControlledTitle`, checked through `controllerMeetsRequirements`.

## §5 What the wave found: five defects, all fixed

1. **A master on a stolen vampire changed hands with it.** "A master card in
   play is controlled by the Methuselah who played it" (p. 9), but "a minion
   card in play is controlled by the controller of the minion it is on"
   (p. 10). A master played on its player's own minion never had a
   controller written down, so it followed the minion. The `ControlChanged`
   reducer now pins such a master to the seat losing the minion. The fix
   applies to every steal and loan. (A trophy follows the vampire, p. 9.
   None is in the pool.)
2. **A combat went on after a combatant left it.** "This is true at any
   point during combat, not just during strike resolution" (p. 30). Only
   damage resolution checked. An Underbridge Stray that burned its last life
   for a press before range left a combat with one combatant, and an option
   enumerator threw on it (fuzz seed 8). `settleCombat` now ends the combat
   at any step. End of Round still occurs (p. 32).
3. **Underbridge Stray could burn itself out of the combat its own block
   started.** "Blocking Minion: the minion currently attempting to block an
   action, or the minion who has successfully blocked the current action"
   (p. 41). The gate read only the block-attempt frame. A test had recorded
   the opposite reading ("once it resolves … the ability is rightly back on
   the table"). That test now covers the combat as well.
4. **A failed referendum to burn a card in play filed a copy in the
   caller's ash heap.** The failed-referendum path burns a card *held* for
   its own referendum. A burn referendum called from the card in play
   (Camarilla Threat, "any vampire may call a referendum to burn this card")
   holds nothing. Its `cardInstanceId` is the card still in play, so a
   second failure made a duplicate card (fuzz seed 132). The path now skips
   `fromCardInPlay` referendums.
5. **Aggravated damage on an unwounded vampire was one wound whatever the
   amount.** Only the first point wounds. Each later point "must burn 1 blood
   to prevent their destruction", or the vampire is burned and "go[es]
   directly to the ash heap" (p. 32, the Tamoszius example). Seven older
   tests had asserted the old blood totals. They now assert the rulebook's.

Defects 2 to 4 surfaced only after one fuzz vampire was given a justicar
title, so that Temptation of Greater Power could be offered. Before that it
had been offered 0 times in 150 seeds. The Sword of the Archangel test had
put its foe into torpor mid-combat, which defect 2's fix now correctly ends.
The test now builds the burn legally, from a ready vampire on 0 blood, which
needed defect 5's fix.

## §6 The bot

- **Calling an auction.** A bot calls an auction for control only on a
  rival's vampire worth at least 2. It must have pool left after the card to
  open the bidding. Both cards declare `playEffects: steal`, which is what
  gets them past the "do not give cards away" guard. A bot never calls a
  Malkavian Time Auction, because selling its own card is a price this
  policy cannot set.
- **Bidding.** A bot bids the least bid that tops the table. It stops when
  what winning costs (`pays`) is more than half the vampire's capacity, or
  would take it to its pool floor. The controller pays half, so it defends
  its own vampire at half price.
- **Never where the runner-up pays.** A bot never bids where the runner-up
  pays too (`runnerUpPays`). A losing bid there is pool spent for nothing.
- **Credit.** A bot takes the most credit it may. The total is the same, and
  pool kept now can still be spent.

No strength claim is made.

## §7 Tests

- `tests/cards/auctions.test.ts` has 17 tests across the three cards,
  including the negative space: capacity 7, an ally, a rival's card, a
  torpid justicar, and the once-per-game limit.
- `tests/ai/auctions.test.ts` has 4 bot tests.
- Regression tests for defects 2 to 4 are in `cheap-tail.test.ts` and
  `table-referendums.test.ts`. Defect 1 is in `auctions.test.ts`. Defect 5 is
  in the seven updated tests and the Sword of the Archangel burn.
- A 150-seed fuzz offers Hostile Takeover 15 times, Malkavian Time Auction 21
  times and Temptation of Greater Power 3 times. Their auctions are answered
  34, 43 and 11 times.

## §8 Open questions for the owner

1. **A pass is final.** This rule is shared with Extremis Boon. An open
   auction lets a seat that passed bid again later. With private values, a
   final pass gives the same winner and keeps the auction finite.
2. **Bidding order.** Hostile Takeover and Temptation of Greater Power start
   with the player who played the card and include the controller. The
   rulings say the player "conducts" the auction, not that they bid first.
3. **Bidding your last pool.** These three cards let a seat bid up to its
   whole pool, per [LSJ 19990825], so a winner can oust itself. Extremis
   Boon keeps its wave 104 reading of pool − 1. Should they agree?
4. **No minion to carry it.** Equipment, a retainer or a location won in a
   Malkavian Time Auction by a seat with no minion is burned.
5. **Temptation's credit.** The winner chooses the credit, from the
   shortfall up to 5. The alternative reading is that credit covers only
   what the winner's pool cannot.
6. **Bots and the Time Auction.** Bots never call a Malkavian Time Auction
   and never bid in one.
7. **Large bid lists.** A controller on 30 pool sees 60 bid options. Each
   bid is legal, so the list is complete. A coarser picker would be a UI
   change.
8. **Two rules readings changed engine-wide.** The aggravated damage fix
   (defect 5) changes the blood a vampire burns in many combats. The p. 41
   reading of "blocking" (defect 3) reverses a recorded reading. Both cite
   the rulebook, and both deserve a look.
