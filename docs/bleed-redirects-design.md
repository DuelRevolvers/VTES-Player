# Bleed redirects — wave 100

| Card | Cost | Shape |
|---|---|---|
| Two Wrongs | 0, trifle | out-of-turn master: a non-predator's bleed on you goes on to the bleeder's prey; shields that bleed from the next redirect |
| Contingency Planning | 1 pool | out-of-turn master, also on your own turn: cancels a minion card that redirects your minion's bleed; caps the pool bled at 1 |
| Murmur of the False Will | 0 | [dom] action modifier +1 bleed (limited); [DOM] reaction redirect, younger vampires only |

Left out as inert: Determine (imbued, Visceratika) and Spirit Marionette
(two Obeah modes, and no V5 vampire has Obeah).

## §1 "A card that would change the target of the bleed" is per MODE

`CardHandler.redirectsBleed` was a boolean that compiled cards derived from
"any mode holds `redirectBleed`". Narrow Minds was its only reader. Murmur of
the False Will made the boolean wrong: its basic half is +1 bleed, and only
its superior half redirects. Reading the boolean, its modifier half would
have paid Narrow Minds' tax, tripped Two Wrongs' shield, and been
cancellable by Contingency Planning.

The declaration is now `redirectsBleed(mode, variant)`, the
`cancelsAsPlayed(mode)` shape. It is **stamped on the card-play frame**
(`CardPlayFrame.redirectsBleed`) at push, because the shield and the cancel
both ask about a play already on the stack (the `isMaster` treatment).

Narrow Minds says "**Minion** cards that change the target of a bleed action
cost +1 blood or life". Two Wrongs is the first master that redirects, so
the filter has to ask both questions. `minionCardRedirects` (handlers.ts)
is the one spelling, read by both pricing sites. Without it, Two Wrongs
would be charged blood with no minion to pay.

## §2 Two Wrongs

- **Who may play it:** the target of a bleed in state C, when the bleeder's
  controller is not their predator, with the p. 9 out-of-turn budget open.
  Ruling: it is legal after failing to block because of stealth (that is
  still declining) and must come before "as the bleed is successful" cards
  [ANK 20211003, LSJ 19980105]. The `action.effects` state-C window is
  exactly that, which Archon Investigation already uses.
- **New target:** "his or her prey" is the bleeder's controller's prey. It is
  re-derived at resolution, since the ring can move between enumeration and
  resolution. It can never be the player's own seat while the predator is
  excluded, but the guard is kept.
- **Blocks reopen:** a target change reopens block attempts (p. 26). The
  existing `TargetChanged` reducer already does this.
- **The shield:** "The next card that would change the target of this bleed
  is canceled as it is played." `ActionFrame.redirectShield` is set at
  resolution and spent by the first pushed play whose frame says
  `redirectsBleed`, whether master or minion card (another Two Wrongs
  included). It fires at **push** for the reason given in
  `out-of-turn-cancels-design.md` §4. With no "no cost is paid", the
  cancelled card's **cost stays paid** [RBK cancel-a-card, ANK 20260216].
- A modifier that does not redirect leaves the shield up (tested with
  Murmur's own +1 bleed half).

## §3 Contingency Planning

- **Who and when:** the controller of the bleeding minion, in the as-played
  window of a minion card whose frame says `redirectsBleed`. "You may play
  this card during your turn" is the `ownTurn` gate Emergency Preparations
  already used. It is still an out-of-turn master, so it still spends the
  p. 9 budget (`out-of-turn-cancels-design.md` §1). **Owner ruling,
  2026-10-06:** kept — the card text lifts only p. 9's own-turn bar, so
  it still uses next master phase's action and still blocks a second
  out-of-turn master before then.
- **"(no cost is paid)"** means `refund: true`.
- **"If more than 1 pool is bled in this action, ignore the excess"** is
  `ActionFrame.bleedPoolCap = 1`. Readings taken:
  1. It is a cap on the pool BURNED, not on the bleed amount. So a card that
     reads the amount (Archon Investigation's "4 or more") still sees it.
     **Owner ruling, 2026-10-06:** kept.
     The cap is applied at the single place a bleed burns pool, and the
     capped figure is what the success hooks receive (`info.amount`, "pool
     bled").
  2. The cap is part of the card's effect, so it lands only with the cancel.
     A Contingency Planning that is itself cancelled caps nothing.

## §4 Murmur of the False Will

- `modifierOrReaction` with a `role` per mode. The modifier half goes only
  to the acting minion and the reaction half only to another Methuselah's
  vampire. Both are existing machinery (Ominous Chorus,
  `other-vampire-modifiers-design.md`).
- **Defect found:** `redirectBleed.youngerOnly` compared `capacityOf` on
  both sides. An ally's capacity reads 0, so **every ally counted as "a
  younger vampire"**, and Redirection's basic mode has been legal against
  ally bleeds since it landed. It now requires the actor to be a vampire.
  Lost in Translation's `allyOrYoungerOnly` was already right, because it
  names allies explicitly.
- Ruling: it "cannot be used to direct a bleed to a Methuselah who would be
  an invalid target" [PIB 20130711]. The engine models no invalid bleed
  target, so the shared redirect enumerator (every seat other than you and
  the bleeder) is the whole answer.

## §5 Tests

`tests/cards/bleed-redirects.test.ts` has 12 scenarios:
- every positive case
- the predator, non-redirect and non-controller negatives
- the per-mode split under Narrow Minds
- the ally regression with Redirection superior as its positive control

All three cards are in the fuzz decks.
