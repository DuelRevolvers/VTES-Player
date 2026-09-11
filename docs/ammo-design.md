# Ammo — and the window between declaring a strike and resolving it

*Manstopper Rounds (101160), Glaser Rounds (100836), Scattershot (101689),
Dragon's Breath Rounds (100580), Caseless Rounds (100304).*

Wave 16, landed **v0.9.9**. Library **545 → 550**.

Five cards, one primitive: a card loaded into **one gun** that changes
what that gun's strikes do for the rest of the combat. They differ in
ways worth asserting against each other — a flat bonus, a bonus with a
timing restriction, a bonus that flips sign with the range, a separate
aggravated packet that also destroys the gun, and no damage bonus at all
but an extra shot.

The cards are the small part. **The wave's content is a window the engine
did not have.**

## 1. Why this family, and the §0 check that came first

The T1 combat bucket was completely untouched — 58 cards, and the largest
family in it is the five Ammo cards. Before anything was written,
`registry.json` was asked whether the pool can actually produce their
target, because a card that filters on something the pool lacks is inert
and §0 keeps inert cards out as firmly as partial ones (Tradition Upheld).

It can: **four guns are in the pool** — .44 Magnum, AK-47, Assault Rifle
and Sniper Rifle. There are zero melee weapons, which is worth knowing for
a later wave but does not touch this one.

## 2. The window

All five print *"only usable before resolution of a gun's strike"*, and
the ruling is exact:

> **"Before resolution" means after strikes have been declared but before
> they resolve.** [RTR 19990105]

The engine had no such moment. `settleCombat`'s `chooseStrike` case ran
`resolveStrikes` the instant both strikes were in, so declaration and
resolution were one indivisible step.

The rulebook keeps them apart. §5 step 4: the acting minion chooses their
strike first, then the opponent — **an ordered, public choice** — and only
then do strikes resolve, simultaneously (p. 30). The rulebook even names
the two halves separately when describing additional strikes: *"another
choose strike step and resolve strike step"*.

So `CombatStep` gains **`beforeResolution`**, and `WindowId` gains
**`combat.beforeResolution`**. It is **not an eighth rulebook step** — it
is a window inside step 4, which is why the "seven steps (p. 29)" comment
above the type is still true and now says so explicitly.

### It opens only when someone can use it

**RECORDED DEVIATION**, and the third of its kind: `combat.damageResolution`
and `action.afterResolution` already carry it, and `outside-combat-design.md`
§2 has the reasoning.

`beforeRange`, `beforeStrikes` and `endOfRound` cycle every seat
unconditionally. This window must not. It sits between declaration and
resolution of **every strike pair in every round of every combat**, and
the only cards that use it are five ammo cards that need a gun. Cycling
four seats through an empty question twice a round would multiply the
decisions in a game with no content and no outcome, in the most-played
part of the engine.

`openBeforeResolution` filters the sequencing order to seats that actually
have a handler or ability option in the window, and skips the step
entirely when none do. **No behaviour changes for a seat that could act**,
and an ordinary combat round has exactly the decisions it had before this
wave — which is also why no existing trace test moved.

## 3. `Strike.weaponCard`, and a latent bug it closed

Ammo goes on **one** gun and only one ammo card may be used on a gun each
combat, so the code has to be able to name the gun. `Strike` recorded only
the weapon's `name`.

`isGunStrike` was already searching the whole table by name and returning
the first weapon it found called that:

```ts
if (p.card.name === strike.name) return p.tags.includes("gun");
```

That is a wrong answer the moment two minions in one combat both carry a
.44 Magnum — not hypothetical, since the .44 is a 2-pool card and any
number of copies can be in play. It was harmless only because its one
caller sets a cosmetic `fromGun` flag.

`chooseWeaponStrike` already receives the card id, so every weapon strike
now records `weaponCard`, and `isGunStrike` prefers it. The name search
stays as a fallback for a strike built elsewhere.

## 4. `AmmoLoad`, and where it is read

`CombatFrame.ammo: Record<CardInstanceId, AmmoLoad>`, keyed by the gun's
card.

**The combat frame is the right scope, and that is the whole reason this
needs no cleanup.** Every ammo card says "for the remainder of this
combat" and "no more than one ammo card can be used on a gun each
combat" — so the record and both rules die with the frame. *A flag that
must be cleared when combat ends is one that will one day survive a combat
ending*, and combat ends four different ways.

Keyed by **card**, not by minion or side: the gun keeps its ammo if it
changes hands mid-combat, and a minion carrying two guns loads them
separately.

**Read at infliction, not stamped on the Strike when loaded.** "For the
remainder of this combat" reaches strikes that do not exist yet — round
3's strike is not built when the ammo goes in during round 1 — so
stamping would mean writing the same rule at two sites, and one of them
would learn a case the other did not.

### The split that a dodge decides

The riders divide by *whose side of the table they act on*, which is p. 33:
a dodge "cancels the effects of the opposing strike **on this minion**".

| Effect | Where | Cancelled by a dodge? |
|---|---|---|
| damage bonus, aggravated packet | inside `inflict` | **yes** — it is damage on the victim |
| burn the gun, grant the extra strike | `ammoRiders`, after both `inflict` calls | **no** — they happen on the striker's own side |

Putting the last two inside `inflict` would have been the obvious build,
and wrong: `inflict` returns early on a dodge, on a range mismatch and on
zero damage, so a dodged Dragon's Breath would have kept its gun.

## 5. The five cards

| Card | `loadAmmo` says | The clause that made it different |
|---|---|---|
| **Manstopper Rounds** | `damage: 1` | the plain case — the family's baseline |
| **Glaser Rounds** | `damage: 2, minGunUses: 2` | "not usable the first time the gun is used" |
| **Scattershot** | `damageByRange: {close: 2, long: -2}` | the same card is a bonus or a penalty |
| **Dragon's Breath Rounds** | `aggravatedDamage: 2, burnGunAfterStrike` | a *separate* aggravated packet |
| **Caseless Rounds** | `additionalStrikeSelf` (1 pool) | no damage at all — an extra shot |

Three rulings did real work:

- **[TOM 19960225]** "additional damage inherits all of the properties of
  the base damage" — so Manstopper/Glaser/Scattershot ride on the existing
  `amount`, which already carries the strike's aggravated flag and its
  `noPreventBy`. Nothing special to write.
- **[LSJ 20030419-2]** Dragon's Breath "does not make the gun base damage
  aggravated". So it is **not** `damage: 2` with an aggravated flag — a
  2R gun with it inflicts **2 normal and 2 aggravated**, two pending
  damages, which `resolveStrikes` already sorts normal-before-aggravated
  for a given victim (p. 34). The test asserts the observable difference:
  2 blood burned and the victim in torpor, where 4 normal would have been
  4 blood burned and still ready.
- **[LSJ 19981006]** Dragon's Breath "does not burn the gun if combat ends
  before the strike resolves". Free: a combat-ends strike returns from
  `resolveStrikes` long before `ammoRiders` runs, and there is a test for
  it.

**Caseless Rounds needed no new mechanism at all.** Its effect is the
AK-47's printed rider word for word (`weapon-riders-design.md` §2) —
`grantAdditionalStrikeTo(bearer, 1, true)` plus `committedStrike`, which
is the .44 ruling the engine has held since the weapons gate. It is the
clearest illustration of what a wave is for: one new primitive (the
window) paid for five cards, and one of them cost nothing beyond it.

### The four rules that live in the enumerator

Deliberately not on the specs. Every ammo card prints all four, so they
sit in one place and a sixth ammo card cannot ship having forgotten one:

1. it goes on a gun **this minion just declared a strike with**;
2. never an opponent's weapon ([LSJ 20020425]) — which falls out of (1),
   since the minion enumerated is the playing seat's own combatant;
3. one ammo card per gun per combat;
4. Glaser's `minGunUses`, compared against `cf.gunUses`.

`gunUses` counts at **declaration**, which is what [RTR 19941109] means by
"wait until the second time a given gun is used" — the window opens after
the strike is declared, so a gun's first strike already reads 1 and Glaser
wants 2.

## 6. What the existing tests caught

Two, both immediately:

- **`supported.test.ts`** — *"pool cost for Caseless Rounds: expected 1 to
  be 0"*. Caseless is the only ammo card that costs anything and the spec
  omitted `poolCost: 1`. The metadata cross-check between the specs and
  the generated registry exists for exactly this.
- **`render.test.ts`** — *"names every printed sub-type and keyword in the
  pool"*: `['ammo']` was missing from How to Play. A new keyword in the
  pool is a new word players will see printed on a card, and the in-game
  rules now explain ammo beside Grapple, Aim and Boon.

Neither was a bug in the cards; both were the promise that admitting a
card makes, being enforced.

## 7. Tests

`tests/cards/ammo.test.ts`, 18 tests. The negative space carries more
weight than usual, because the window opens only when a seat can use it —
so **"no option" is the normal state of every combat in the game**, and a
too-narrow enumerator would be invisible.

- the window **does not open** when nobody holds ammo (the default state
  of every combat), opens when someone does, and closes on a pass;
- it is offered at **neither** earlier moment — checked while the acting
  minion is choosing *and* while the opponent has yet to declare, because
  "not offered yet" has to be asserted where it could plausibly have been
  offered;
- not offered on a **hand** strike, with the gun still present so the
  fixture fails for the right reason;
- not offered to the seat whose gun it is not ([LSJ 20020425]);
- a **second** ammo card is refused, after the first was offered — so the
  absence is the rule biting, not the card never having been playable;
- Glaser refused on the gun's first use **with Manstopper offered in the
  same seat at the same moment** as the control;
- Scattershot **+2 close and −2 long** on the same loaded gun;
- Dragon's Breath's split packet and its gun-burn, including the
  combat-ends case where the gun survives;
- Caseless's second gun strike, that the hand strike is barred, that it
  fires **once each round** — and a **control** showing the same fixture
  without it gets no second strike at all.

Fuzz: all five dealt in beside the guns. Green on the first run, which for
once is just green — no latent bug came in with them.

## 8. Not done

- **Magazine (101142)** — "put this card on a gun and put an ammo card
  from your hand on this card", used later as if played from hand. It is
  ammo-adjacent but its mechanic is *cards holding cards*
  ([LSJ 20021128]: if it leaves play, the card on it is burned), which is
  a different build. Deferred deliberately, not blocked.
- **No other "before resolution" card is in the pool yet.** The window is
  card-agnostic and any future one uses it as-is.
