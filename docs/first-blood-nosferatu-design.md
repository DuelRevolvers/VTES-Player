# Wave 116: First Blood Nosferatu

Built in 0.11.66 (2026-11-10). This wave opens Nosferatu groups 4–5 in
`config/crypt-groups.json`, with the owner's approval on 2026-11-10, and
brings the First Blood Nosferatu half deck to 100%.

## §0 Scope

First Blood Nosferatu was missing six vampires and no library cards. One
of them, Beetleman, prints no ability. The other five print one, and each
is implemented here. Opening the groups admits only vampires that are
whole, so 8 Nosferatu entered: the five below and three that print no
ability. The other 15 Nosferatu in groups 4–5 stay out until their
abilities are built.

The deck joins the precon chooser under the 0.11.65 rule
(`libertine-ball-design.md` §5). It's a half deck by design, so the
chooser labels it the same way it labels the New Blood starters. Its bots
play **Bruiser**, the same style as the V5 Nosferatu decks.

## §1 Jeremy "Wix" Wyzchovsky

> Camarilla: Jeremy can bleed with +1 bleed as a Ⓓ action.

A bleed is already a Ⓓ action, so this is +1 bleed on his bleed actions.
It's a conditional static (`actionKinds: ["bleed"]`) rather than a flat
`bleed: 1`, so his bleed value outside a bleed action stays printed. KRCG
lists no ruling for the card.

## §2 Harold Tanner, and Owl Companion

> Camarilla: The controller of the minion in combat with Harold plays with
> an open hand.

**Owner ruling (2026-11-10):** while Harold is in combat, the opposing
minion's controller plays with an open hand **for the whole table to
see**, and Owl Companion does the same.

Before this, `openHandsFor` showed Owl Companion's open hand only to the
owl's controller. The function now opens the hand to every seat. Harold
reuses Owl Companion's `revealsOpposingHand` static, which
`opposingCombatStatics` already reads off the other combatant's attached
cards, and a crypt ability is an attached card. The hand closes by
itself when the combat frame goes, as before.

## §3 Benjamin Rose

> Camarilla Prince of Washington, D.C.: Benjamin can call a referendum to
> give you +1 hand size until the end of the game as a +1 stealth
> political action.

This reuses Black Forest Base's `politicalGrant`, with two additions:

- `who.self`: only the vampire who carries the card is offered the action.
- `effect.handSizeForGame`: a passed referendum gives the caller +1 hand
  size.

No turn or combat frame lasts until the end of the game, so this grant
sits on the seat (`SeatState.handSizeBonus`), added through
`addHandSizeBonus` with scope `"game"`. `handSizeOf` reads it. The grant
stays if Benjamin later leaves play, because the card gives the bonus "until
the end of the game", not "while Benjamin is in play". The card has no
once-per-turn limit, so it can stack across turns, one political action
per vampire per turn (p. 24).

## §4 Gustaphe Brunnelle

> Camarilla primogen: Gustaphe can enter combat with a minion controlled by
> your predator or prey as a Ⓓ action.

This adds a new `RushTargetFilter.controlledBy: "predatorOrPrey"`, read by
`rushTargetOk`. At a table of three, every other seat is a predator or prey;
the test uses four seats so the seat across the table can be checked.

**Defect found:** a rush GRANTED by a card in play (`rushGrant`) never
passed its target terms to the action, so resolution never re-asked
`rushTargetOk` and a target that stopped qualifying couldn't fizzle the
action [LSJ 20070411]. Rushes played from the hand already did this. Every
granted rush now passes `rushTargetFilter`.

## §5 Petra

> Camarilla: Damage Petra inflicts on Baali is aggravated. A vampire burns
> 1 blood after using a press to continue combat with her.

- **Baali:** this reuses Akhenaten's `allDamageAggravatedVsClan`. No Baali
  vampire is in the pool yet. **Owner ruling (2026-11-10):** build the
  clause anyway. The test uses a constructed Baali.
- **The press toll:** `pressToContinueBloodToll`, read off the other
  combatant by `pressToContinueToll`. It's asked at both places a press is
  used: a press card (`applyPressCard`) and a spent press credit. Only a
  VAMPIRE pays, so an ally pressing against her owes nothing. A press to
  end the combat costs nothing.

## Tests

`tests/cards/first-blood-nosferatu.test.ts` (18 tests) covers each clause
in both directions, plus the chooser entry. The fuzz minions carry no crypt
abilities, as in earlier crypt waves, so the fuzz decks are unchanged.
