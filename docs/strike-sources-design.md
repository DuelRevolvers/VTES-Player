# What a strike is made of

Tranche 3, wave 28. Four combat cards that declare a strike, chosen so
that the differences between them are the content.

| Card | KRCG | Printed |
|---|---:|---|
| Channeling the Beast | 100328 | Strike: hand strike **or use a melee weapon strike**, at +1 damage. (1 blood) |
| Lucky Blow | 101131 | **Do not replace until after combat.** The same strike, for no blood. |
| Up Yours! | 102083 | Close range only. Choose a weapon on the opposing minion. Strike: **X damage, where X is that weapon's pool cost**. |
| Backflip | 100123 | Long range only. Strike: dodge, **with an optional press**. |

Three are data on machinery that already exists — `strikeHandBonus` with
`orMeleeWeapon` (Anticipation), `delayedReplace: "afterCombat"` (wave 20),
`strikeDodge`, the range gates. The fourth is not.

## §1 — A pair that differs by one clause

Channeling the Beast and Lucky Blow print the *same strike*. The
difference is that Lucky Blow costs no blood and is not replaced until
after combat, which is the whole of its drawback. Having both in one wave
is the point: each is the other's control, and a replacement clause that
silently did nothing would be invisible with only one of them.

*"You cannot use another strike card as the hand strike for Lucky Blow"*
[LSJ 20010627] needs no code — a minion chooses one strike, and choosing
this card IS that choice.

## §2 — Damage printed on somebody else's card

Up Yours! is the first strike whose size is not on the card declaring it.
`strikeWeaponCost` enumerates **one option per weapon on the opposing
minion**, so the choice is made as the card is played and rides in the
option id (p. 25's rule for every other target). At resolution the pool
cost is read from the registry through `ops.registry`, which exists for
exactly this: a card reasoning about a different card while resolving.

With no weapon on the opponent there is nothing to choose and **the card
is not offered at all** — the negative-space test, and the honest reading
of "choose a weapon possessed by the opposing minion".

A weapon burned between the choice and the strike leaves X at 0. The
strike still happens and deals nothing, which is what a strike with no
damage already does ([RTR 19960221]) — not a special case.

## §3 — A rider is not a second effect

Backflip's "with an optional press" was first written as a `press` effect
beside `strikeDodge` in the same mode. That does not work, and the reason
is worth recording: **a mode resolves in ONE window**, and the compiler
maps each effect kind to the window its card is offered in. `strikeDodge`
belongs to `combat.chooseStrike` and a standalone `press` belongs to the
press step, so putting both in one mode makes the mode's window
ambiguous and one of the two never fires.

`strikeDamage` already had the answer — riders live *inside* the strike
primitive — so `strikeDodge` gained the same `riders` field. The rule:
**if a clause happens because the strike happened, it is a rider on the
strike, not an effect beside it.**

## §4 — The range gates are MODE rules

`onlyAtLongRange` and `onlyAtCloseRange` are read from `mode.usable` and
are **silently ignored at spec level** — `rulesHold` lists them under
"per-minion / combat rules, checked elsewhere" and falls through. Written
on the spec, Backflip was offered at close range and Up Yours! was not
offered at all. This is the "empty for the wrong reason" shape in its
other direction: a gate that does nothing looks exactly like a gate that
passes.

## What the wave found

No engine defect — two of my own mistakes, both about **where a thing
belongs** rather than what it does: a rider written as a sibling effect,
and a mode rule written on the spec. Both were caught by tests that
asserted the negative space; neither would have been visible from a
passing positive case.

## Tests

`tests/cards/strike-sources.test.ts`, 5 tests. Two negative: Up Yours! is
not offered with no weapon to name, and Backflip is not offered at close
range. The pair test drives Channeling the Beast and Lucky Blow through
the same fixture and asserts both offer the weapon option *and* the plain
hand strike beside it.
