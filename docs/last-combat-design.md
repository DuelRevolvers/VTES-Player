# The last four combat cards, and a vest

*Dust Up (100597), Taste of Vitae (101945), Hunger of Marduk (102227),
Anticipation (102350), Kevlar Vest (101040).*

**This finishes Combat: 4 → 0**, the third card type to reach zero after
Retainer and (buildably) Master. Kevlar Vest joins them because it is a
combat card in everything but its printed type, and because it needs the
same question answered: **what a strike is, and what it is worth.**

| Card | The one thing it adds |
|---|---|
| **Dust Up** | "This strike **cannot be dodged**." |
| **Taste of Vitae** | "Gains blood equal to the **blood lost by the opposing vampire to damage** this round." |
| **Hunger of Marduk** | a granted **steal-blood** strike, for the round |
| **Anticipation** | cancel the opposing strike card, paid in **blood** |
| **Kevlar Vest** | prevention **scaled by the strike's source** |

## 1. "This strike cannot be dodged"

A dodge is the one strike that answers every other: p. 33 says it
"cancels the effects of the opposing strike on this minion", and
`resolveStrike` implements that as a single early return —
`if (victimStrike?.dodge) return;`, checked in two places (damage, and
the non-damage strike effects).

**`Strike.undodgeable`** is one more condition on those two returns, and
it belongs on the STRIKE rather than on the frame: it is a property of
the blow, not of the round, and Dust Up prints it on one mode of three.

**Reading on record: it does not beat a dodge's other half.** A dodge
still deals no damage of its own and still cancels *combat-ends* nothing;
"cannot be dodged" means only that the dodging minion does not escape
**this** strike. Nothing else about the dodge changes, which is why this
is a gate on two returns rather than a rewrite of dodge.

## 2. Taste of Vitae — blood lost is not damage taken

"This vampire gains blood equal to the amount of **blood lost by the
opposing vampire to damage** this round."

`CombatFrame.damageTakenThisRound` already exists (Flesh of Marble) — and
it is the wrong number. Damage is what was *inflicted*; blood lost is
what the victim actually *burned to mend* it (p. 31), and the two come
apart in exactly the cases that matter:

- a vampire who cannot mend everything goes to **torpor** and burns only
  what they had;
- an **ally** burns life, not blood, and this card says *vampire*;
- damage prevented is damage that costs no blood at all — but prevention
  already removes it from the queue, so that case is covered.

So **`CombatFrame.bloodLostThisRound`** is its own tally, written where
the mend actually happens in `applyResolvedDamage`. **Two numbers that
look interchangeable and are not** — the same shape as `damageTaken`
(queued) versus `resolveCombatDamage` (inflicted), which the
round-recurring wave had to separate for Flesh of Marble.

**"Not usable by a vampire being burned or going to torpor"** is a
usable rule read at End of Round: the player must still be ready. The
existing **`byStillReadyCombatant`** (built for Disarm) says exactly
that, so this card adds nothing.

## 3. Hunger of Marduk — a granted steal-blood strike

"This round, this vampire can strike, ranged: **steal 1 blood or life**
(becoming blood)."

`Strike.stealBlood` has existed since the strike-effects gate, and
`CombatFrame.grantedStrikes` — the specified-strike list generalised in
the weapon-riders wave — is where a strike offered *by a card already
played* lives. This card is the third user, and the first to need the
grant to **carry a number**, so the list holds
`{ kind, amount? }` rather than a bare `StrikeKind`.

**"Blood or life" needs no branch**: an ally's life lives in the same
`blood` field behind the `kind` discriminant, which is the allies gate's
central choice, and `stealBlood` already moves from whichever it is.

**Reading on record: the grant lasts the ROUND, not the combat.** "This
round, this vampire can strike…" — so it is cleared at the round
boundary beside `handStrikesAggravated`, unlike Treasured Samadji's
once-per-combat grant. That is why `grantedStrikes` needed a lifetime at
all rather than only a spend.

## 4. Anticipation — the third pay-to-cancel currency, on a strike card

"[AUS] Burn 1 blood to cancel the opposing minion's strike card as it is
played, and its cost is not paid (the minion chooses a strike again)."

**This is the Vozhd of Gravesend's clause with a different payer and a
different cost** — and Gravesend built all of it: `abilityInAsPlayed` is
not needed here (Anticipation is a card played from hand, not an ability
of a card in play), `CardPlayFrame.isStrike` answers "is it a strike
card", and `cancelPendingCard(true)` is "its cost is not paid".

The card's window is `card.asPlayed`, which p. 7 reserves for cancels and
wakes — and a card played from hand in that window needs no opt-in,
because the restriction `abilityInAsPlayed` guards is on *abilities of
cards in play*.

**"The minion chooses a strike again" is again describing existing
behaviour** — the fourth card in five waves to do so. A cancelled strike
card never fills `cf.strikes[side]`, and `chooseStrike` is a step the
settle loop returns to while that slot is null.

Its basic mode is "hand strike **or use a melee weapon strike**, at +2
damage" — a strike that is one thing *or* another is two options, so it
is one mode with a `variant` per legal weapon, the shape the option id
already carries.

## 5. Kevlar Vest — prevention that reads the strike

"Once each combat, the bearer can prevent **2 damage from gun strikes or
1 damage from any other source**."

Every prevention in the engine so far is a flat number. This one asks
what dealt the damage, and the answer is on the strike: a gun is a
`Strike.source === "weapon"` whose card carries the `gun` tag — the same
pair `weaponDamageNullified` reads.

**`PendingDamage.fromGun`** is set at `pushPendingDamage`, the one
chokepoint, rather than being recomputed in the prevention window: by the
time the window opens the strike may have been replaced (an additional
sub-round), so the fact has to travel with the damage. That is the
`damageCycleLen` lesson — **a fact about an item belongs on the item.**

**Reading on record: "any other source" includes environmental and
retainer damage**, which have no strike at all. `fromGun` is false for
them by construction, so the vest prevents 1, which is what the card
says.

## 6. What this leaves

Combat reaches **zero**. The remaining 34 cards are Action (7), Ally (7),
Action Modifier (6), Master (5, all BLOCKED), Equipment (3), Reaction (2)
and Political Action (1) — and a growing share of them are the
wraith/zombie and Path sets that are BLOCKED pending owner review, or the
four named singles in `partial-support.md`.
