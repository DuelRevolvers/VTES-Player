# Boons (wave 104)

Four master cards, each a debt between two Methuselahs: Lesser Boon
(101095), Major Boon (101145), Minor Boon (101219) and Extremis Boon
(100676). Life Boon, the fifth, landed in wave 103
(`docs/victory-points-design.md` §4).

Each boon is played at a moment the engine had no window for, and each
leaves a clause on the table that a later moment reads back:

| Card | Played when | Standing clause |
|---|---|---|
| Lesser Boon | your minion **would** successfully block | the actor cannot block your minions |
| Major Boon | another Methuselah is bled, after blocks are declined | burn it to make them pay a bleed on you |
| Minor Boon | another Methuselah's vampire is **going** to torpor | that vampire cannot bleed you |
| Extremis Boon | you are being ousted | the high bidder steals 2 pool per master phase action |

## §1 Choosing the family

The filters ran first, before any card text was read
(CLAUDE.md, "Filter the candidate list FIRST"):

- **None of the five candidates needs a clan, sect, title or Discipline.**
  Blocks, bleeds, torpor and ousts all happen in the V5 pool.
- **King's Favor (101058) is also a Boon and stays out.** It needs a Guruhi,
  and the V5 crypt has none, so it would be whole and inert (§0).

## §2 Lesser Boon

> "Only usable when a minion you control would successfully block. The
> action resolves as if unblocked instead. Put this card on the acting
> minion. This minion cannot block your minions. Burn this card if you block
> this minion again, or when this minion's controller has less than 6 pool."

**The window is the block attempt itself.** "Would successfully block" can
only be asked while the attempt is open, so the card is offered in the
attempt's impulse window when `blockWouldSucceed` holds for the attempt
underway and its blocker is controlled by the seat asking.

**`BlockAttemptFrame.asIfUnblocked`** is a third way for an attempt to end,
beside success and failure. `resolveBlockAttempt` then:

- Emits no `BlockSucceeded`, so nothing that reads a successful block sees
  one. That is the ruling: "Effects that depend on the successful block do
  not see the block as successful" [RTR 20080808].
- Does not lock the blocker. That lock is a consequence of a successful
  block (p. 27).
- Sends the action to state C, the same transition `settle` makes from
  state A, including `notifyBlocksDeclined`.

**Reading on record: "resolves as if unblocked" goes to state C.** The block
window is over, so nobody else may attempt to block. The cards that print
"*continue* the action as if unblocked" (Go-getter, Form of Mist) use a
different verb. See §8, question 1.

**The three standing clauses are statics** on the card, which is attached to
the acting minion and controlled by the boon's player (p. 16):

- `cannotBlockControllersMinions` is read by `mayAttemptBlock`, the one
  predicate both block doors share. "Your" means the boon's controller.
- `burnIfBlockedByController` is read on the successful-block path, beside
  Malajit's burn.
- `burnWhenBearerControllerPoolBelow: 6` is a `settle` sweep, for the reason
  the capacity drain is one: it holds however the pool fell.

## §3 Major Boon

> "Only usable if another Methuselah is being bled by a minion you do not
> control and the bleed amount is 1 or more, after blocks are declined. Put
> this card in play. You burn pool for this bleed instead of the target
> Methuselah (and the bleed is still successful), or this card if you don't
> burn at least 1 pool. If you are about to be successfully bled, you can burn
> this card to have that Methuselah burn pool instead of you (and the bleed is
> still successful)."

**`ActionFrame.bleedPayer` changes who burns the pool, and nothing else.**
The engine's one bleed burn in `applySuccessEffects` reads it. The target
stays the target, so the Edge (p. 21) and every `onBleedSuccess` hook are
the bleed's own. Contingency Planning's ceiling still applies to what the
payer burns.

**Both halves set the payer.** Playing the card makes you the payer. Burning
it later makes "that Methuselah", the `boonTarget`, the payer. The burn is
offered in state C of a bleed aimed at you, while you are still the one
paying.

**"…or this card if you don't burn at least 1 pool"** is checked in
`finishAction`, which every way out of an action passes through. A bleed
reduced to 0, or made unsuccessful (Spying Mission superior), burns the
card.

**`bleedBoonApplied` closes the action to everything but "would be
successful" cards.** Three rulings meet here:

- "Only modifiers and reactions that can be played 'when the action/bleed
  would be successful' can be played after Major Boon is played or burned"
  [LSJ 20090205].
- A second Major Boon cannot be played on the first: the first's loss is a
  card effect, not a bleed [RTR 19970630].
- Two boons in play cannot both be burned on one bleed [LSJ 19990218].

One filter in the engine's action decision does all three. It keeps only
plays whose handler answers `playableWhenActionWouldSucceed` for that mode.
`compileSpec` sets it for any mode whose usable rules include
`ifActionWouldSucceed`, which today is Spying Mission superior.

## §4 Minor Boon

> "Only usable when a vampire controlled by another Methuselah is going into
> torpor. Put this card on that vampire to prevent that vampire from going to
> torpor (combat still ends, if any). This vampire cannot bleed you. Burn this
> card if this vampire rescues a vampire you control from torpor."

The ruling sets the timing: "Is played after the combat ends, keeping the
vampire out of torpor" [RTR 19950509-2]. So the vampire spends a moment
**going** to torpor: out of its combat, which ends, but not in torpor yet.

**`MinionState.torporPending`** is that moment. `isReady` reads it as not
ready, so the combat ends through the ordinary "no longer ready" check
(p. 30), and damage still resolving against the vampire treats it as
wounded. The `TorporPending` event sets it, and `TorporPrevented` or
`WentToTorpor` clears it.

**`vampireToTorpor` is the one door to torpor.** It was written out at three
sites: unmendable damage, aggravated damage and a strike or card that sends
a vampire. The funnel sets `torporPending` only when some Methuselah could
play into the `torpor` window. It probes the window the way the
after-resolution window is probed: mark, ask, unmark. Otherwise it does
exactly what the three sites did.

**The `torpor` window opens in `settle` once no combat is underway**, through
`TorporFrame`. The frame lists no vampires: which ones are going is derived
from the flag. When the window closes, every vampire nobody saved arrives
with the hooks an arrival fires. The leave-ready hooks (Guardian Angel,
Secure Haven) fire first. The combat-leave hooks (Dead Pool) fire after,
against the opponent captured when the vampire went. A saved vampire fires
neither, because it never went.

**"This vampire cannot bleed you" rides `bleedAnnounceTax`** as a tax nobody
can pay. Every bleed's gate already asks that function: the basic bleed, a
bleed action card and a granted bleed. "A bleed from this vampire cannot be
redirected to you either" [PIB 20130711] is asked by every redirect
enumerator through `bleedBarred`: the compiled one (Deflection, My Enemy's
Enemy) and Two Wrongs.

**The rescue burn** is read in the rescue's success effects, where the
rescuer and the rescued vampire are both known.

## §5 Extremis Boon

> "Only usable when you are being ousted. Other Methuselahs may bid pool to
> keep you in the game. If one does, put this card in play. As a master phase
> action, the high bidder may steal up to 2 pool from you. You may burn this
> card by giving that Methuselah 6 pool during your master phase."

**The victim plays it into wave 103's `oust` window.** It is out-of-turn, so
not on the victim's own turn (p. 8). It is not offered when nobody could
bid, because the card would then do nothing.

**The auction is a chain of choice frames.** Each frame asks one bidder, and
its `applyChoice` raises the next. The rules taken:

- **Bidders** are the standing Methuselahs other than the victim, in turn
  order from the victim's prey. A seat going out in the same oust cannot
  bid.
- **The opening bid keeps the victim in the game** [ANK 20190827]: 1 − pool,
  Life Boon's arithmetic for the same phrase.
- **A bid may not take the bidder's last pool**, the line Life Boon draws.
- **Each bid tops the last, and a pass is final.** The pass is an answer, not
  a decline, because a declined frame simply goes away and the auction has
  to move on.
- **Only the high bidder pays, and pays the victim.** "The pool of the
  highest bidder goes to the target Methuselah. The losers do not lose pool"
  [LSJ 20031121-1].

**The card is in play while the bids run** and is burned if nobody bids.
Nothing reads an Extremis Boon until it has a `boonCreditor`, which the end
of the auction sets.

**`PermanentInPlay.boonCreditor`** is the reverse of `boonTarget`: the
Methuselah this card's controller owes. The table shows it as "← Bob",
titled "Owed to Bob".

**Both abilities are offered in a master phase:**

- The high bidder's steal takes 1 or 2 pool. It spends a master phase
  action, and that spend is its latch. The card opts in with
  `abilityAnySeat`, because the steal belongs to a seat that does not
  control it.
- The victim's buyout gives 6 pool and burns the card. It is not a master
  phase action, and it is not offered when 6 pool is all the victim has.

## §6 The defect the wave found

**Blood Trade's "burn all boons" could not see Life Boon.** Blood Trade
burns every entry tagged `boon`, and Life Boon entered play tagged only with
its name. Blood Trade's comment said that no boon in the pool stays in play,
which was true until wave 103.

`putPermanentInPlay` now adds the `boon` tag to any card whose printed
keywords include it, whichever card put itself in play. It is the lesson
"a deferral is a claim about the card POOL as it was", made by a comment
rather than by a ledger row.

**A second, latent defect, fixed in passing:** the mandatory-bleed gate
(Elen Kamjian) never asked `bleedAnnounceTax`. Tainted Vitae's tax could be
charged on a vampire that could not pay it, which the tax's own comment
says never happens. The gate now asks, which is also how "cannot bleed you"
reaches a mandatory bleed.

## §7 The bot

Each boon is a pool spend, or a gift, that the option does not carry as a
cost. So each needs a guard keyed on what the play does, never on the card's
name:

- **Lesser Boon:** never. A seat that blocked chose to stop that action.
  Keyed on the option's `unblock` param.
- **Major Boon:** only to stop an oust (the bleed takes the target's last
  pool), never for its own prey, and never down to its pool floor. Keyed on
  `pays`.
- **Minor Boon:** only for its predator's vampire, which the card then stops
  from bleeding it. Keyed on the `torpor` window.
- **Extremis Boon:** the victim always plays it. Wave 103's oust guard
  refused it, because a seat on no pool is always under its floor; the floor
  now prices only a gift to someone else. A bidder opens the bidding for a
  victim who is not its prey, when it has pool to spare, and never bids
  higher. It never buys the boon out.

No strength claim is made. These are guards against a bad play, not a model
of when a boon pays.

## §8 Open questions for the owner

1. **Lesser Boon: does "resolves as if unblocked" end the blocking?** Built
   as yes: the action goes to state C and no other Methuselah may attempt to
   block. The alternative is the "continue as if unblocked" reading, where
   block attempts reopen.
2. **Lesser Boon: does "if you block this minion again" mean a successful
   block?** Built as yes. A failed attempt does not burn it.
3. **Major Boon: after it, only "would be successful" plays remain.** The
   ruling names modifiers and reactions. Built to drop masters and in-play
   abilities too, which no ruling mentions either way.
4. **Minor Boon: a vampire going to torpor that takes more aggravated damage
   in the same resolution** is treated as already wounded, so it burns blood
   or is burned (p. 34). Is that right?
5. **Extremis Boon: the bidding order.** Built as turn order from the
   victim's prey, with a pass final. Should it start elsewhere, or let a
   seat that passed bid again?
6. **Extremis Boon: may the high bidder steal the victim's last pool?**
   Built as yes, which ousts the victim. And may a bidder bid their own last
   pool, or the victim buy out with exactly 6? Built as no, Life Boon's line
   (wave 103, question 1).
7. **Extremis Boon: a high bidder who is later ousted** leaves the card in
   play with nobody to pay. Built as a card that stays and does nothing.
   Should it burn?
8. **The `torpor` window leaks information**, as the `oust` window does
   (wave 103, question 4): it opens only when someone holds a Minor Boon.
