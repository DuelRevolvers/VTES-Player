# Getting armed in the middle of a fight

Tranche 1 wave 55, 2026-09-16 (v0.10.46). Concealed Weapon (100392),
Zip Gun (102208), Molotov Cocktail (101235). Library 687 → 690.

Three combat cards played when a fight has already started, all of which
end with a weapon on the table that was not there a moment ago. They
differ in where the weapon comes from and how long it stays:

| Card | The weapon is | It arrives | It leaves |
|---|---|---|---|
| Concealed Weapon | a card in your HAND | before range | never — it is ordinary equipment |
| Zip Gun | THIS card | before range | never — *"kept as normal equipment"* |
| Molotov Cocktail | THIS card | as a STRIKE resolves | after one use, or at the end of combat |

## §1 What the wave found: a weapon's abilities were welded to the equipment card type

`spec.weapon` — the strike, the per-combat maneuver, the sniper's long
range, the keyword cancel, the unlock-on-kill rider — was compiled by a
block sitting **inside `compileEquipment`**. Nothing in it is about the
equipment card type. What a weapon does is a question about the **entry in
play**; the card that put the entry there is no part of the answer.

The tell had been sitting in the tree since wave 8, in Weighted Walking
Stick's own doc comment:

> *"what is bespoke is the weapon strike it offers once in play, **which
> no other card shape provides** (the weapon ability normally comes from
> an equipment card)."*

That is not a fact about VTES. It is a description of where the code
happened to put a function, written down as though it were a property of
the game. A combat card that becomes a weapon needed a bespoke handler for
a strike that is nothing but `spec.weapon`, and Zip Gun and Molotov would
each have needed their own copy — three hand-rolled weapon strikes, each
free to drift from the real one.

It is `addWeaponAbilities(spec, handler)` now, called by `compileEquipment`
and by `compileCombatCard`. Same shape as wave 53's `ammoTargetGun`
extraction and for the same reason: **a rule that lives inside one
compiler is not shared, it is merely nearby.** The generalisation of the
"one question asked in two places will drift" lesson is that a question
asked in *one* place can still be unaskable from everywhere else.

It **composes** rather than assigns — a combat card that becomes a weapon
already has ability options of its own — and `useAbility` dispatches on
the `action` param the four weapon options already carried, so nothing new
had to be invented to tell them apart.

## §2 Molotov Cocktail: the attach IS the strike

*"Ranged strike: put this card on this minion; it becomes a weapon
equipment that can strike: 2R aggravated damage, not usable the round it
is put in play. Burn after use or at the end of combat."*

Three pieces, each its own small thing:

- **`strikeAttachSelfWeapon`** — `attachToVictim` pointing the other way.
  It lands with the one-shot weapon riders rather than inside `inflict()`,
  which never runs for a strike that does no damage. That placement is the
  whole of the ruling: *"if the opponent strikes: combat ends, this strike
  is not resolved and the Cocktail is not put on this minion, even if
  combat continues thanks to another effect"* [ANK 20200203-1]. A
  combat-ends strike returns from `resolveStrikes` far above, so the
  `resolves()` gate is never reached and the card is never put down. The
  same reading [LSJ 19981006] already gave Dragon's Breath Rounds.

- **`weapon.notUsableAttachRound`** — this is a question about the
  **card's** age, and nothing in the engine could answer it. `cf.round`
  gives the *combat's* age; `notFirstRound` (RPG Launcher) asks about the
  combat too. A card that arrives in round 3 has to know it arrived in
  round 3, so `PermanentInPlay.attachedRound` is stamped in the
  `PermanentEnteredPlay` apply — read off the combat frame, which is part
  of the state a replay rebuilds, so the **event did not have to change**.
  The gate sits above every option the weapon offers, not just the strike,
  because [LSJ 20021028] says a weapon's optional maneuver cannot be used
  when its strike cannot be.

- **`weapon.burnAtEndOfCombat`** — through `onCombatEnded`, beside
  `unlockOnKill`, which is the one hook that already fires there.

## §3 Zip Gun: two riders and a tag

*"…Ammo cards cannot be used with this gun. It does 1R damage each strike,
with an optional maneuver each combat. Bearer takes 1 damage during strike
resolution when striking with this gun, but only once each combat. This
card is kept as normal equipment and is not discarded after combat."*

- **"Ammo cards cannot be used with this gun"** is a **tag**, read by
  `ammoTargetGun` — wave 53's extraction, paying for itself two waves
  later, since the new rule went in once and every ammo card got it. A tag
  for the same reason `"gun"` is one: the ammo window holds an entry in
  play and has neither a handler nor a spec to ask.

- **The bearer's 1 damage** is `weapon.selfDamageOnStrike`, a second field
  beside Grenade's `selfDamageAtCloseRange` rather than a flag on it: the
  two share only the damage, and their gates have nothing in common.
  Environmental, like every bearer self-damage [LSJ 19970801] — source
  null, so nobody inflicted it and no prevention reads it.

  The **once each combat** latch is `cf.bearerSelfDamageDone`, and
  deliberately **not** `cf.gunUses === 1`, which was the tempting
  one-liner. `gunUses` is counted at **declaration**; a first strike that
  never resolves would have spent the one use and the bearer would never
  take the damage, contradicting [LSJ 20100310] — *"no damage is done to
  the bearer if he does not strike with the gun."* The latch belongs after
  `resolves()`, not before it.

- **"Kept as normal equipment and is not discarded after combat"** needed
  **nothing**: an attached entry is how every card that becomes equipment
  already persists. What needed building was the opposite — Molotov's
  end-of-combat burn. Worth saying because the clause reads like a
  requirement and is in fact a reassurance.

## §4 Concealed Weapon: a filter on a card still in a hand

*"This minion equips with a non-unique weapon card from your hand
(requirements and cost apply as normal). The weapon cannot cost 3 or more
pool or inflict (with a regular strike) aggravated damage or 4 or more
damage."*

`playFromHand` already brought equipment in outside its own equip action,
with `types`, `tags` and `nonUniqueOnly`. What was new is that Concealed
Weapon interrogates the incoming card about **its printed strike** — and
the asker holds a `CardHandler` and nothing else. Hence
`CardHandler.weaponProfile`, denormalized by `addWeaponAbilities`, which
is also why it had to come out of the equipment compiler: a card can now
become a weapon without being an equipment card, and the profile has to
follow the weapon, not the type.

The three readings, each from a ruling:

- **Cost** is measured on the figure this bearer would **actually pay**,
  not the printed one. *"Cost modifications that are not limited to cards
  'played' are considered before checking for card cost"* — Black Cat can
  conceal a Combat Shotgun; Centralized Background Check makes a .44
  Magnum too costly [LSJ 20040701] [ANK 20181216]. `playFromHandChoices`
  already computed exactly that figure for affordability, so the gate is
  one line beside it.
- **Damage** is what the weapon would inflict against a **generic
  opponent** [RTR 19980623], with **no strength or other bonus counted**
  [LSJ 20020821] [LSJ 20020904]. A strength-based weapon is therefore
  measured off the base 1 strength every minion has: a Bastard Sword
  (`damage: null, handBonus: 1`) reads 2, not 0. A combat-ends strike
  (Smoke Grenade) inflicts nothing and reads 0.
- **Aggravated** means **printed and unconditional**: Poker's aggravated
  damage against Kiasyd is a conditional effect and does not disqualify it
  [LSJ 20020729].

The limits are the printed numbers **minus one** — `maxPoolCost: 2` and
`maxDamage: 3`, because "3 or more" and "4 or more" are exclusions, not
ceilings. The same off-by-one The Erciyes Fragments' "capacity above 4"
was one wave ago, and the reason the test names a legal Chainsaw (3
damage) next to a barred Submachine Gun (4 pool): each bar is exercised
**alone**, so a filter that matched by accident would show.

## §5 What the wave found

**A rule welded to a card TYPE rather than to the thing it describes**
(§1) — the headline, and a shape worth looking for: a doc comment
asserting that no other card can do something, where the truth is that no
other *compiler* can reach the code.

**A latch put before the gate instead of after it** (§3) — `cf.gunUses`
was already there, already per-combat, already keyed on the card, and
counting the wrong moment. The near-miss field is the recurring hazard
(the `disciplineBoost`-is-wrong-by-one-level shape from wave 40).

**Nothing else.** Sixty fuzz seeds ran green with the three cards dealt
in, unlike wave 50's widening. A tally over those sixty seeds offered
Zip Gun 14 times and Molotov Cocktail 11; **Concealed Weapon was offered
zero times**, because it needs a combat and a legal weapon in hand at the
same moment, and a random agent rarely holds both. Its gate is proven by
`tests/cards/armed-mid-combat.test.ts` in both spaces — the same standing
as Suppressing Fire.
