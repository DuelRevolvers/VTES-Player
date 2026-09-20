# Aggravated damage

Wave 74 (2026-09-20). Burning Wrath (100271), Song in the Dark (101825),
Bone Spur (100237), Burst of Sunlight (100273), Adaptability (100021).

Five cards about the **aggravated flag**, in both directions: three put it on,
two take it off. They meet in the middle, which is the point of the wave — the
pair that matters is Bone Spur against Adaptability, and Adaptability against
wave 72's Skin of Night.

**Raking Talons (101538) stayed out as INERT** (§0): it requires a Gargoyle,
and the V5 crypt has none. **Jua Vema (101027)** stayed out too — its superior
is conditional on locking an "Aye" on the vampire, which nothing in the pool
can produce.

---

## §1 — What the flag is worth

Aggravated damage **cannot be mended** (p. 34). So to a ready vampire, "2
damage" and "2 aggravated damage" differ in exactly two observable ways, and
they move in **opposite** directions:

| | blood | ready? |
| --- | --- | --- |
| 2 normal | 2 burned to mend | still ready |
| 2 aggravated | untouched | in torpor |

Every assertion in this wave's test is that pair. A test that only checked
"went to torpor" would pass for a card that dealt 5 normal damage, and one
that only checked blood would pass for a card that dealt nothing.

Song in the Dark is the wave's control for this and nothing else: **2 damage /
2 aggravated damage**, same amount, same range, one bit apart.

## §2 — Bone Spur: a round and a COMBAT are two fields

> "[pro] For the remainder of this ROUND, this vampire's hand damage is
> aggravated. [PRO] As above, but for the remainder of this COMBAT."

`CombatFrame.handStrikesAggravated` already existed (Claws of the Dead, Wolf
Claws) and is cleared at every round boundary. The superior needed a second
field, `handStrikesAggravatedCombat`, which the boundary does not clear —
the `firstStrikeRound` / `firstStrikeNextRound` precedent. Two fields rather
than one field with a scope, because **the round boundary has to clear one and
not the other**, and a scope tag would have to be consulted at the clear.

The strike reads `handStrikesAggravated[from] || handStrikesAggravatedCombat[from]`.
That is the sibling-hook check: the round flag had one reader, and adding a
second source means the read is now the one place both are asked.

**Testing this needed long range.** An aggravated hand strike sends the
blocker to torpor, which ends the combat — so a test asking "is the flag still
set in round 2" has no round 2. The fixture fights at long range, where a bare
hand strike inflicts nothing (p. 29), and the press credit gets it to round 2
with both combatants alive.

## §3 — Adaptability: the same conversion at one strike's scope

> "[pro] This vampire treats all aggravated damage from the opposing minion's
> STRIKE as normal damage. [PRO] Prevent all aggravated damage from the
> opposing minion's strike."

Wave 72's Skin of Night converts for the **round** and is recorded on the
minion. Adaptability converts for **one strike**, so it is recorded on the
damage **items** (`PendingDamage.treatAsNormal`). A round-scoped
implementation would have been over-generous: a minion that strikes twice in a
round would have both strikes converted by one card.

What carries over unchanged from wave 72 is the thing the ruling forces:
**neither version clears `aggravated`.**

> "[FOR] Cannot be used to prevent aggravated damage, **even if the minion
> treats them as normal damage**." — Resilience [LSJ 20040812-2]

Only `applyResolvedDamage` asks the question, so Resilience's
non-aggravated-only prevention stays gated out after Adaptability resolves —
asserted directly, and asserted as a *pair*: the superior stays hidden and the
plain "prevent 1" basic is still offered, so the gate narrowed the MODE and not
the card.

The two modes are the interesting contrast. The basic **mends** what it
converts (blood is spent, the vampire survives); the superior **prevents** it
(nothing is spent). Both leave the vampire ready, so a test that only checked
"not in torpor" could not tell them apart — the blood totals are what
distinguish them.

Both modes are gated on the pending damage being **aggravated and sourced from
the opposing minion**, so neither is offered against normal damage, against a
retainer's output, or against Burst of Sunlight's own recoil.

## §4 — What the wave found: a strike rider welded to weapons

> "[tha] Strike: 1R aggravated damage. **This striking vampire also takes 1
> aggravated damage.**" — Burst of Sunlight

The engine already models this: `Strike.bearerSelfDamage`, with `anyRange` and
`oncePerCombat` options, resolved in `oneShotRiders`. But it was reachable
**only from a weapon**:

- `chooseWeaponStrike` accepted `selfDamageOnStrike` / `selfDamageAtCloseRange`;
  `chooseCardStrike` accepted nothing of the kind.
- `oneShotRiders` opened with `if (!strike?.weaponCard) return;` — so even a
  card strike carrying the field would have been skipped.

**What a strike does to its own striker is a question about the STRIKE**, not
about weapons. This is the third instance in three waves of the same lesson
(`spec.weapon` inside `compileEquipment`; the round gates inside one window;
this). The gate is now `if (!strike) return;`, the `oncePerCombat` latch keys
on the weapon card **only when there is one** — no card prints that clause
without being a weapon — and burn-after-use, which genuinely needs the weapon
card, is guarded explicitly.

The recoil is **environmental** (`source: null`), so no "damage from the
opposing minion" prevention or reaction reads it, and Adaptability cannot
convert your own Burst of Sunlight.

## §5 — Fixture notes

Three of this wave's first-draft assertions were wrong in the same way: **M
strikes back.** A cost read after the combat is the cost *plus* whatever was
mended from the blocker's own hand strike. Costs are now read by `settle`ing
the card play — passing the as-played cycle so `resolve` has run — and reading
blood before any strike resolves.

And the window was wrong before it was right: `handStrikesAggravated` resolves
at **`combat.beforeStrikes`**, not `combat.beforeRange`. The existing Claws of
the Dead test is what settled it — reading a sibling card's trace is faster
than reading the window switch, and it is the same fact.
