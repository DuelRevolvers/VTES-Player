# Thaumaturgy ranged strikes

Wave 80 (2026-09-20). Drain Essence (100582), Eldritch Glimmer (100624),
Machine Blitz (101137).

Three [tha] ranged strikes whose **amount is not a printed constant**: one
steals blood, one buys extra damage with blood, and one reads its number off
the opponent's own weapon. The wave is about where each number comes from and
*when* it is fixed.

---

## §1 — What each card is

| Card | Basic | Superior |
| --- | --- | --- |
| Drain Essence (1 blood) | ranged; steal 2 blood — **not round 1** | steal 4 |
| Eldritch Glimmer (1 blood) | 2R **+ X**, burning X blood — not round 1 | 4R + X |
| Machine Blitz | ranged; X = the chosen weapon's damage | X + 1 |

All three are tested at **long range**, where a ranged strike is worth having
and a hand strike answers with nothing — so the damage on the table is the
card's alone.

Eldritch Glimmer's "not usable on the first round" is printed inside the basic's
text and the superior says "as above", so **both** modes carry the gate. Getting
that wrong is invisible unless a test plays the superior in round 1.

## §2 — Buying damage with blood

`perBloodX` on `strikeDamage`: one option per affordable X, the choice riding in
the option id, and the blood burned as the strike is declared. `prevent` and
`additionalStrike` already had exactly this shape, so the only new part is the
enumeration on a damaging strike.

**X = 0 is a legal choice**, and it is asserted separately. A card that "can
burn X" is not obliged to, so an enumeration starting at 1 would quietly make
the card cost blood it does not have to.

## §3 — Machine Blitz: three rulings, three design decisions

> "[tha] Choose a weapon possessed by the opposing minion. Strike: ranged; X
> damage, where X is the amount of damage the chosen weapon would inflict as a
> strike."

Every non-obvious choice here comes from a ruling rather than from taste:

1. **X is `weaponProfile.damage`.** "A weapon's current damage is the amount it
   would inflict if used as a strike by the bearer against a **generic
   opponent** at the appropriate range" [RTR 19980623] — and that field's own
   doc comment cites the same ruling, because it was built for Concealed
   Weapon's threshold. It was already the right number; this card is its second
   reader.
2. **X is captured at ANNOUNCEMENT**, not at resolution: "the current damage
   amount is set when Machine Blitz is announced" [LSJ 19970224]. So the number
   is computed in `resolve` and passed to `chooseCardStrike` as a fixed
   `damage`. This is the opposite of `strikeWeaponCost` (Up Yours!), which
   deliberately reads X **at resolution** — and the two are right for the same
   reason: a printed *pool cost* cannot change between the two moments, and a
   weapon's *current damage* can.
3. **It is not a use of the weapon.** "No restriction nor side-effect applies:
   Bomb is not burned, Sawed-Off Shotgun can be used multiple times"
   [LSJ 20010806-1]. So it must not go through the weapon-strike path at all —
   it is a plain card strike that happens to read a number off a weapon. And it
   is **not aggravated** even if the weapon is, which falls out of the same
   decision.

That third one is asserted directly: the weapon is still attached to the
opponent after the strike resolves.

This is the first wave where the rulings did most of the design work rather
than confirming it — and the reason it was cheap is that they all pointed at
machinery that already existed for other reasons.

## §4 — A gate deliberately NOT added

> "Can target a minion with less blood or life than the amount stolen."
> [RTR 20010711]

The tempting gate — do not offer "steal 4" against a victim holding 1 — is
wrong. Drain Essence is offered and simply takes what is there. Asserted, because
"a card is not offered" is the kind of thing that gets added for tidiness and
then quietly makes a card unplayable in the situation it was printed for.

## §5 — Mutation-checked, as of last wave

All nine assertions passed on the first run, which since wave 79 means running
the check rather than reasoning about it. Both new amount calculations were
broken on purpose — the weapon's damage forced to 0, and X dropped from the
damage sum — and **two tests failed, then passed again on restore**.

That is now the standing move whenever a wave's test file is green first time:
it costs one command and it distinguishes "the code is right" from "the test is
not looking".
