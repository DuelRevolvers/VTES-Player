# A successful hunt — design

Wave 102 (0.11.40). Four cards that key on a vampire hunting successfully:

| Card | KRCG id | Type | When it is played |
|---|---|---|---|
| Masquerade Endangered | 101183 | Master: out-of-turn | State C of a hunt, before it pays |
| Tainted Vitae | 101926 | Reaction (Ministry, 2 blood) | State C of your predator's hunt |
| XTC-Laced Blood | 102198 | Master: out-of-turn | After a hunt that gained blood |
| Restricted Vitae | 101614 | Event (Gehenna) | Discard phase, like any event |

Tests: `tests/cards/hunt-success.test.ts`.

The candidates were filtered for inertness first. Earth-Feeder (Laibon),
Follow the Blood (Black Hand), Ghost-Eater (Harbinger of Skulls), The Guruhi
Are the Land, Ravager (Kiasyd) and Wanderer's Counsel (Akunanse) need a clan or
sect that the V5 crypt doesn't have. Tainted Vitae needs a Ministry vampire,
and the V5 crypt has 18. Enhanced Coagulant also burns itself "after this
vampire successfully hunts", but it's mainly a weapon that moves onto the
opposing vampire, so it belongs with the weapon families. Sunset Strip,
Hollywood is a recruit-cost location.

## §1 What "successfully hunts" means

The rulings on all four cards say the same thing: "A hunt is not successful
if no blood is gained, even if the hunt action is still successful"
[LSJ 20050720-2]. Before this wave the engine answered the question by
reaching the hunt branch of action resolution. That was right while nothing
could make a hunt gain zero blood. Masquerade Endangered and Restricted
Vitae can, so the answer moved to where the blood is paid.

`VtesEngine.payHunt(af, printed)` is now the only place that pays hunt
blood. It takes the following steps:

1. Return at once if the hunter is gone or Masquerade Endangered stripped
   the hunt (`af.huntGainsNoBlood`).
2. Compute the hunt value: the printed amount, plus the minion's own "+N
   hunt" (`huntBonusOf`), plus this action's (`af.huntBonus`, Tainted
   Vitae). "The hunt bonus applies to non-standard hunt actions"
   [RTR 20030519].
3. On a steal hunt, cap the value at the target's blood [LSJ 20100915].
4. Return if the gain is zero. The action is still successful, but the hunt
   isn't.
5. Otherwise pay the blood, then Festivo dello Estinto's fill from the bank,
   then Hospital Food's bonus, and mark the hunt successful with
   `af.huntSucceeded`.
6. Fire `onHuntSuccess` and release any "do not replace until a vampire
   successfully hunts" wait.

A full vampire's hunt still succeeds. It gains the blood and the bank takes
the excess (p. 6), which is the reading `docs/futile-options-design.md`
already took. This is open question 1 in §6.

**Found, defect 1: a hunt ACTION CARD wasn't a hunt.** Psychophagia prints
"+1 stealth hunt action", and its spec comment said the action kind mattered.
But `CardActionParams.actionKind` knew only `bleed` and `cardEffect`, so the
card announced a `cardEffect`. Three things followed from that:

- Thirst's "who did not hunt" didn't see it.
- Festivo's "−1 stealth during hunt actions" didn't apply to it.
- A hungry vampire couldn't use it to make the mandatory hunt.

The new `huntAction` spec flag makes the card announce `hunt`. Its blood now
goes through `payHunt`, so "+N hunt", Masquerade Endangered and the success
triggers all reach it. The basic hunt's payout runs only when `!af.card`, so a
hunt action card isn't paid twice.

The mandatory-hunt branch of `minionPhaseOptions` now also offers a hungry
vampire's hunt action cards, because playing one is making the hunt.

## §2 Masquerade Endangered

> Master: out-of-turn. Put this card on a vampire who successfully hunts.
> This vampire does not gain any blood from the hunt. This vampire doesn't
> unlock as normal during his or her unlock phase. During this vampire's next
> unlock phase, burn this card.

"Does not gain any blood from the hunt" can only be true before the hunt
pays. So the card is played in state C: blocks are closed, the hunt is going
through, and nothing has been paid yet. It sets `af.huntGainsNoBlood`, which
also unmakes the success. Nothing keyed to success fires: Hospital Food, The
Anarch Free Press, XTC-Laced Blood, and Restricted Vitae's replacement.

The gate is `huntWouldSucceed`, which asks whether the hunt would gain blood.
It deliberately ignores an earlier copy of this card: "Multiple copies may be
played by different Methuselahs after a single action" [TOM 19950921].

On a hunt action card (Psychophagia), the strip removes only the blood. The
ally is still removed from the game.

The card carries `bearerDoesNotUnlock` (Detection's static) and burns itself
in `onControllerUnlock`. The unlock sweep runs before the unlock hooks, so the
vampire is held for exactly one sweep, and every copy burns at the same
sweep, as the ruling says.

## §3 Tainted Vitae

> Only usable if a vampire controlled by your predator is about to
> successfully hunt. The hunting vampire gets +2 hunt this action and put this
> card on them; you still control this card. The attached vampire must burn 1
> additional blood to announce a bleed action (if it is not canceled as
> played) against you.

"About to successfully hunt" is state C, the same moment as Masquerade
Endangered. The card isn't offered once the hunt has been stripped. The
reacting vampire is a ready, unlocked Ministry vampire (`canReact`) that can
pay the 2 blood after every reaction-cost modifier (`playCostFor`). The +2 is
a hunt value, so on a steal hunt it's taken from the target, which is the
ruling.

The tax is `bleedAgainstControllerBloodTax`, read through `bleedAnnounceTax`.
"Against you" means the card's controller, not the bearer's. The tax is a
price on announcing, and announcing always means having the blood, so the
tax is gated as well as charged.

| Path | Gate | Charge |
|---|---|---|
| Basic bleed | `minionPhaseOptions` | `announceAction` |
| Bleed action card | `costOf` (card cost plus tax) | `announceCardAction` |
| Granted bleed | the `act:…:bleed` enumerator | `announceEntryAction` |
| The Platinum Protocol | its own enumerator | `announceCardAction` |

An action card's own cost is paid at resolution (p. 27), and the tax is paid
at announcement. So the gate asks for both, and each payment site charges
only its own.

`announceCardAction` runs only after the card survives its as-played window,
so "(if it is not canceled as played)" holds by construction.

The charge is emitted just after `ActionAnnounced`. Emitting it between the
lock and the announcement broke the fuzz invariant "an announcement is
immediately preceded by its actor's lock". Seed 140 of a 150-seed run caught
the first draft.

## §4 XTC-Laced Blood

> Master: out-of-turn. Only usable when a vampire successfully hunts. Put
> this card on that vampire. During this vampire's minion phase, he or she
> must hunt, even if at capacity. Any vampire may burn this card as a +1
> stealth Ⓓ action.

The card is played in `action.afterResolution`, gated on `af.huntSucceeded`.
That's the first moment the success is known, so the card is never played
after a stripped hunt or a steal that took nothing.

The obligation is the `mustHunt` static, read through the new `mustHunt(m)`
in `state.ts`, beside p. 19's hungry vampire. Four places ask it:

- The mandatory-hunt option list
- The stuck-vampire gate in `canAct`
- Uncontrolled Impulse's non-mandatory count
- Restricted Vitae's steal hunt

The card's obligation is one hunt per minion phase, and announcing a hunt
discharges it. That's the Thirst reading of `huntedThisPhase`
[LSJ 20050727]. The hungry vampire's obligation isn't discharged that way,
because at 0 blood they still must hunt.

The burn action is the compiled `vulnerableTo: { who: { kind: "vampire" },
stealth: 1 }`. It's directed at the card's controller, the player who played
it (p. 16).

## §5 Restricted Vitae

> Gehenna. Do not replace until a vampire successfully hunts. Vampires cannot
> hunt unless they must hunt. Vampires who must hunt can steal 1 blood from a
> younger vampire as a Ⓓ hunt action.

The card is one seat permanent with `huntingRestricted`, read through
`huntingRestricted(state)`:

- **The bar:** the voluntary hunt option and every hunt action card are
  withheld from a vampire who doesn't owe a hunt.
- **The steal hunt:** `hunt:<m>:steal:<victim>`, offered beside the mandatory
  hunt. The targets come from `stealHuntTargets`: vampires of other
  Methuselahs (Ⓓ, p. 25), younger by capacity, ready or in torpor ("a
  vampire"), and not untargetable by the actor. "It can target a vampire with
  no blood" [LSJ 20050720-2], and such a hunt steals nothing and fails. It
  can be taken once per turn as a card-granted action [RBK], recorded as
  `cannotRepeat: "stealHunt"`.
- **Stealth:** the steal hunt is announced as a `hunt` with a `targetMinion`,
  directed at that minion's controller, with 0 stealth. The basic hunt's +1
  is the basic hunt's (p. 21), and the card prints none.
- **Replacement:** `delayedReplaceUntil: "vampireHunts"`, a new
  `DelayedDrawCondition`. It's released in `payHunt` and nowhere else, because
  no event marks a hunt's success. The wait is on the seat, so a burned copy
  still waits [LSJ 20080805].

## §6 Readings that need the owner's word

1. **A full vampire's hunt counts as successful.** The vampire gains the blood
   and it drains (p. 6). This keeps `docs/futile-options-design.md`. The
   other reading, "no net gain means no success", would make Masquerade
   Endangered unplayable on a full vampire and would stop The Anarch Free
   Press and Harvest Rites from firing for one.
2. **A hunt action card can make a mandatory hunt.** A hungry Hecata may play
   Psychophagia instead of hunting.
3. **The steal hunt has 0 stealth** and targets only other Methuselahs'
   vampires, including vampires in torpor.
4. **XTC-Laced Blood asks for one hunt per minion phase.** A vampire that
   hunted and was then unlocked doesn't have to hunt again.
5. **Tainted Vitae's tax is strict.** A vampire that can't pay it can't
   announce the bleed, instead of paying what it has. That isn't how
   Kaymakli Barrier's directed-action tax is built; see the note that
   follows.

**Found, defect 2 (filed, not fixed here): Kaymakli Barrier's tax reaches
only basic actions.** "Directed actions cost this vampire an additional
blood" is charged in `announceAction` alone. A directed action card or a
granted directed action pays nothing. The tax is also emitted between the
lock and `ActionAnnounced`, so the fuzz invariant would break if the card
were ever in the fuzz decks. It's a sibling of this wave's tax rather than
part of the family, so it's filed as its own task.
