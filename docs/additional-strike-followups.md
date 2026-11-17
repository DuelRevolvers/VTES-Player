# Additional-strike timing: known follow-ups

The targeted limited-source fix prevents a second limited grant in the same
round, separately for each combatant, and resets it for the next round. It
is **not** a complete audit of the additional-strike timing model.

- **Pending strikes and further sources:** the current grant window can
  offer a non-limited source while that minion already has additional strikes
  pending, then closes for the rest of the round. The VEKN ruling says to
  resolve pending additional strikes before gaining more, when another source
  is allowed ([LSJ 20001206](https://www.vekn.net/general-rulings)); handling
  that correctly requires re-opening the appropriate window after the strikes
  and respecting the initial opportunity and sequencing for both combatants.
- **Optional weapon grants:** AK-47 and Caseless Rounds grant their optional
  additional strike when the engine sees the gun strike. The striker can now
  DECLINE it in the additional sub-round (`strike:decline`: a no-damage
  declaration, which releases the gun commitment; `CombatFrame.optionalAdditionalStrike`).
  Still open: choosing a different limited source instead of the weapon's grant.
  The limited-source guard already stops a second limited grant, and the
  choice has to be made before the grant, not after it. See the
  [VEKN discussion](https://www.vekn.net/forum/rules-questions/69208-additional-strikes-compounded-card-effects).
- **Strike-plus-additional modes:** the current compiler can offer a mode
  which declares a strike as a new card in the additional-strike grant window.
  This timing needs a separate review alongside the pending-strike change;
  don't assume all strike-card interactions are fixed by the limit guard.

These are identified limitations, not completed fixes or manually audited
cards. They are separate from the 4,158-card audit inventory.
