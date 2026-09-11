# The combat retainers — the three shapes a retainer takes in a fight

*Vengeful Spirit (102107), Zombie (102210), Resplendent Protector
(101612).*

Wave 22, landed **v0.10.5**. Library **579 → 582**.

Three retainers whose whole content is what they do once combat starts.
They are a family because between them they cover every way a retainer
can be involved in a fight, and the engine only had the first one.

| shape | card | what it needed |
|---|---|---|
| **hits** every round | Vengeful Spirit | nothing — `combatRoundDamage` is six waves old |
| **prevents**, and is not spent | Resplendent Protector | a per-**combat** latch beside the per-round one |
| **is spent**, for something outside the fight | Zombie | a granted action whose price is the card offering it |

## 1. Vengeful Spirit needed nothing

> "Wraith with 2 life. The employer gets +1 bleed. Vengeful Spirit
> inflicts 1 damage on the opposing minion each round of combat during
> normal strike resolution at close range."

`PermanentStatics.combatRoundDamage` was built in the retainer wave and
three cards already use it; `statics.bleed` is older still. The whole
card is `{ bleed: 1, combatRoundDamage: { amount: 1, ranged: false } }`.

**"At close range" is `ranged: false`** — the absence of an "R" in the
damage text, which is how every other card in the pool says it (p. 30).

It is in the wave precisely because it needed nothing: it is the control
that says the other two are not more of the same.

## 2. Zombie: a retainer that pays for a non-combat action

> "…This vampire can **burn this retainer** to gain 2 blood as a +1
> stealth action."

`grantedAction` had six arms and none of them could be priced in the card
granting the action. `addBlood` with a cost would not do: the cost is not
blood or pool, it is *this permanent*, and after paying it the action's
source no longer exists.

So `burnSelfForBlood` is its own arm. Two details are deliberate:

- **The actor IS the employer.** A retainer's granted action is announced
  by the minion it sits on, so the enumerator uses the `actor` binding
  rather than re-deriving a bearer.
- **Blood first, then the burn.** The retainer pays for a gain that has
  already happened, and the bearer can have left play between announcement
  and resolution — so the resolve arm reads the target with `findMinion`
  and burns the card either way.

The enumerator also refuses the option when the employer is **at
capacity**, the same guard `addBlood` carries: an action whose whole
content is "gain 2 blood" does nothing for a vampire who cannot hold it,
and taking it spends a real action
(`docs/futile-options-design.md`).

## 3. Resplendent Protector: a rate that is not a cost

> "The minion with this retainer may prevent 1 damage **each combat**."

`retainerAbilities` already had `lockToPrevent` (Szlachta Bodyguard) — but
that one is **paid for by locking the retainer**, and Resplendent
Protector is not paid for at all. There is also `allyAbilities.preventPerRound`,
which is the right rate on the wrong kind of card and the wrong period.

So `preventPerCombat` sits beside them, and the difference is only the
latch: `cf.usedThisCombat`, marked when the ability fires, with the
retainer left unlocked and in play. **A rate is not a cost**, and
collapsing the two would have made this card lock itself — visible
immediately in a fight, and wrong in a way that also loses the retainer's
other work.

## 4. Tests

`tests/cards/combat-retainers.test.ts`, 3 tests — deliberately thin,
because two thirds of this wave is vocabulary that is already pinned:

- Resplendent Protector prevents, is **still in play and still unlocked**
  afterwards, and is **not offered again in the same combat**;
- Zombie's action burns the retainer and adds the blood — both halves, so
  a version that did one would fail;
- Vengeful Spirit is asserted as **data**: the two statics are what the
  card prints. Its behaviour is already covered by the Carrion Crows and
  Dread Mastiff traces, which is the honest reason not to write a third
  copy of the same combat.

Fuzz: all three dealt in. Green.

## 5. Not done

The rest of the combat retainers each add a clause that is its own build:

- **Ghoul Retainer** (100819) — "inflicts 1 damage **or may use a weapon
  not used by the employing minion** … this is not a strike, although it
  does count as 'using' the weapon." A retainer wielding equipment
  outside the strike system.
- **Duma Rafiki** (100593) — burns an opposing weapon *or* inflicts damage,
  a choice at strike resolution.
- **Razor Bat**, **Elephant Guardian**, **Stone Dog** — Gargoyle- and
  Laibon-gated, so **inert by §0** until those clans are in the pool.
- **Spiritual Protector** (101853) — immune to non-aggravated damage
  *and* bars equipment for anyone blocking the employer: two clauses,
  neither shared with anything here.
