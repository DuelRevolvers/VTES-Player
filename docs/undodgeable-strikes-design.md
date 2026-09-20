# Undodgeable strikes

Wave 76 (2026-09-20). Scorpion Sting (101693), Earthshock (100604),
Projectile (101493).

Three cards whose point is that a **dodge does not answer them**. That makes
the dodge the wave's control, and it is the reason these three are one wave:
the flag sits on a hand strike, on a ranged strength strike, and on a
fixed-damage-or-weapon strike, so the same sentence is asserted against three
different kinds of blow.

---

## §1 — What each card is

| Card | Basic | Superior |
| --- | --- | --- |
| Scorpion Sting | hand +1 | …**and undodgeable** |
| Earthshock (1 blood) | strength, ranged, undodgeable, not vs flight | strength+1, same |
| Projectile | 1R **or** a ranged weapon strike, undodgeable | …with an additional strike (limited) |

`Strike.undodgeable` and `strikeHandBonus.undodgeable` already existed (Dust
Up), so Scorpion Sting needed nothing new — it is the wave's clean statement of
the mechanic, its two modes differing **only** in whether the dodge works.
`strikeDamage` did not carry the flag; it does now.

## §2 — A strength strike that reaches

> "[pot] Strike: **strength ranged** damage."

The damage formula is a hand strike's (`strengthOf(side) + bonus`, which is what
`bonus: 0` means) but the blow reaches. The resolution had two branches asking
the same question different ways:

```ts
if (strike.damage !== null) { if (cf.range === "long" && !strike.ranged) return; … }
else                        { if (cf.range !== "close") return;               … }
```

The fixed-damage branch consults `ranged`; the strength branch hard-coded close
range, because every card that had printed a strength-based strike **was** a
hand strike. Earthshock is the first that is not, so the second branch now
consults `ranged` too — the standing lesson about siblings written at different
times not agreeing.

One narrowing came with it. "This vampire's **hand** damage is aggravated"
(Bone Spur, Claws of the Dead) is applied in that same branch, so it would have
promoted Earthshock's ranged strike as well. It is now gated on
`!strike.ranged`. Every card that existed before this wave is close-range in
that branch, so nothing else changes — but the tell is worth recording: **a
branch that used to identify one kind of strike stops doing so the moment a
second kind reaches it.**

## §3 — "or use a ranged weapon strike"

`orMeleeWeapon` has existed since Anticipation; Projectile wants its ranged
sibling. Written as a second block rather than one field with a reach, because
the two filter on the tag **the card printed** and a card names one or the
other. One option per qualifying weapon, the choice in the option id.

Asserted both ways: a ranged weapon adds a second option for the mode, and a
**melee** weapon adds none. Without the melee half, a filter that ignored the
tag entirely would pass.

## §4 — "Not usable against a minion with flight"

A gate on the option, read against the minion the strike would answer. Flight
is a tag on an attached card, and **no V5 vampire prints it** (the Gargoyles are
not in the pool), so in practice it only ever arrives from a card in play —
which is exactly how the test produces it.

This is a gate that could easily be *inert* rather than wrong, so the negative
is asserted against a positive on the same board: with a flight retainer on the
blocker the card is not offered, and with a plain equipment on the blocker it
is. Otherwise "not offered" would also be satisfied by a card that is never
offered at all.

## §5 — What the wave found, in its own test

The first version of this file walked the combat with "Bob dodges where he
can", and **Bob never dodged.** A dodge is not a free option in VTES — it comes
from a card or a granted strike — so `options.find(o => o.id === "strike:dodge")`
was always `undefined` and the walker quietly hand-struck instead. Six of the
seven tests passed, including every "undodgeable" assertion, on a board where
nothing was ever dodged.

It surfaced only because Scorpion Sting's **basic** mode is supposed to be
stopped by a dodge, and that one assertion failed. The undodgeable half could
not have caught it: it expects damage to land, which is what happens when no
dodge occurs.

Two fixes, both worth keeping as a pattern:

- `grantBobADodge` pushes a real granted dodge onto the combat frame, so the
  option exists.
- `playOut` **reports whether a dodge was actually taken**, and `damageDealt`
  throws if it asked for one and did not get it. A control that can silently
  not happen is not a control — this is the "empty for the wrong reason" lesson
  applied to a walker's choice rather than to an option list.

The positive control matters as much here: with nobody dodging, both Scorpion
Sting modes land the same 2 damage. Without that line, "the basic deals 0
against a dodge" would also pass for a card that deals 0 to everyone.
