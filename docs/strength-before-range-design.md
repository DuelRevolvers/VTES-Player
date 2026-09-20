# Strength, before range

Wave 79 (2026-09-20). Fists of Death (100738), Song of Serenity (101827),
Shadow of the Wolf (101741).

Three cards, all "only usable before range is chosen", all moving **strength**.
Between them they complete a 2×2 the pool had three corners of.

---

## §1 — What each card is

| Card | Basic | Superior |
| --- | --- | --- |
| Fists of Death (1 blood) | +1 strength, **this combat** | +2 |
| Song of Serenity | opponent **−1**, this round; one each combat | −1 for the **combat** |
| Shadow of the Wolf (2 blood) | additional strike (limited) + **+1 strength this round** | …with an optional press |

Strength is only observable through a hand strike's damage, so every assertion
in the test is damage dealt or the frame field that produces it.

## §2 — The missing quadrant

The pool already had:

| | this round | this combat |
| --- | --- | --- |
| **own** | `combatCredits.strength` | `addStrength` |
| **opponent's** | — | — |

Song of Serenity wants both of the empty cells, so `opposingStrength` carries a
`scope` rather than being split into two primitives: one card prints both, and
the only difference between them is which field the round boundary clears.

**No new engine op was needed.** `addRoundStrengthTo(minion, amount)` and
`addCombatStrengthTo(minion, amount)` already take a minion and resolve the
side themselves — they were written for in-play abilities that have no
`CardPlayFrame` — so "the opposing minion gets −1" is those same ops called
with the foe's id and a negative number. The minion-addressed form existing for
a different reason is what made this cheap.

"A vampire may play only one Song of Serenity each combat" is per **card name**,
so it is `spec.combatLimit: "combat"` and covers both modes. The test asserts
that specifically: after the basic, the **superior** is barred too, which a
per-mode limit would not have done.

## §3 — An additional strike that is a before-range CREDIT

Shadow of the Wolf grants an additional strike, and the standalone
`additionalStrike` primitive lives in the **choose-strike** window. Using it
here would have put the whole mode in that window, and the card says "only
usable before range is chosen" — so the mode would have been offered three
steps too late.

`combatCredits` is the before-range credit primitive, so it gained
`additionalStrike?: { count, limited }`. One effect, one window, three credits
(strength, the strike, and a press at superior). The alternative — a window
override on the mode — would have put a card's timing in two places.

The test asserts the card is offered **at `combat.beforeRange`**, which is the
whole point: get the window wrong and the card still works, just never when its
own text says it can be played.

## §4 — Round versus combat, told apart properly

Three of these five modes are round-scoped and two are combat-scoped, and the
difference is invisible in a single round. The last block of the test presses
into **round 2** and reads the fields there:

- Fists of Death's bonus survives.
- Shadow of the Wolf's does not.
- Song of Serenity's basic lapses; its superior persists.

Reading the frame field in round 1 would have passed for a card written to the
wrong field, because both fields feed the same strike.

## §5 — A mutation check instead of trusting a green run

All ten assertions passed on the first run. Waves 77 and 78 had both just been
caught by that — a test that is green immediately has not yet been shown to be
capable of failing — so rather than reasoning about it, the penalty was
temporarily changed from `-1` to `0` and the suite re-run: **two tests failed,
then passed again when it was restored.**

That is cheap and conclusive where staring at the assertions is neither. Worth
doing whenever a wave's whole test file is green on the first attempt.

The CONTROL test beside it is the other half: without Song of Serenity, M's
hand strike costs V1 a point. Without that line, "V1 lost no blood" would also
hold for a card that does nothing at all, or for a fixture where M never
strikes.
