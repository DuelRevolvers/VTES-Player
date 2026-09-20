# Dodges

Wave 78 (2026-09-20). Vampiric Speed (102089), Staredown (101859),
Preternatural Evasion (101482), Sideslip (101779), Acrobatics (100020),
Behind You! (100149).

Six cards built on "Strike: dodge". The primitive has existed since the
strike-sources wave, so nothing here is about dodging — it is about **what each
card buys alongside the dodge, and which window that second thing lives in**.
Two of the six put their two modes in two different windows.

---

## §1 — What each card is

| Card | Basic | Superior |
| --- | --- | --- |
| Vampiric Speed | dodge | dodge + optional press |
| Staredown | dodge | strike: combat ends |
| Preternatural Evasion | dodge | **burn 1 blood** to end combat |
| Sideslip | dodge | **prevent 1** — one at superior each round |
| Acrobatics (1 blood) | additional strike (limited) | dodge + additional strike |
| Behind You! | maneuver — **first round only** | dodge — first round only |

Four of them have a plain dodge as their basic, which gives the wave one
positive shared by four cards: a dodge that stopped working could not hide
behind any of them.

Acrobatics is the mirror — its **basic has no dodge** — and that is asserted
the hard way rather than by reading the spec: after the basic, M's hand strike
still lands and a point is mended, so the mode is provably not dodging.

## §2 — A price on a strike

Staredown and Preternatural Evasion have the same two modes; the only
difference is that Preternatural Evasion **pays a blood** for the combat-ends
strike. `strikeCombatEnds` carried only `unlockSelf`, so it gained a
`bloodCost` — the shape `preventAllThisRound`, `grantCloseManeuver` and
`startNewRound` already use: the price gates the option and is burned as the
strike is declared.

The pair is the assertion. Both cards end the combat, so "the combat is over"
proves nothing about either one; the blood total is the only thing that
separates them.

The negative is a **mode** gate, not a card gate: with no blood the superior
disappears and the free basic stays. A gate that took the whole card away would
look identical to a test that only checked the superior was gone.

## §3 — One at superior each ROUND

> "A vampire can play only one Sideslip at superior each round."

`oncePerCombatAtSuperior` existed; this is the same per-mode limit one scope
shorter. **No new engine work at all** — `modeCombatLimit` has accepted
`"round"` since it was written and nothing had ever returned it, and
`cf.playedThisRound` is already cleared at the round boundary. The limit is
recorded per name *and* mode, so the basic is unaffected.

Sideslip is also the card whose two modes live in two windows: the basic is a
strike, the superior is **prevention**, in the damage window. Asserted both
ways — the superior is absent at the strike step and present at damage
resolution.

## §4 — The card that checks wave 73's hoist

Wave 73 found `onlyFirstRound` being read inside `combat.beforeRange` only, and
hoisted it above the window switch so every combat window gets it. **Nothing in
the pool exercised that.**

Behind You! does: its basic is a **maneuver**, which lives in `combat.range`,
and both modes carry the first-round gate. Before the hoist the basic would
have stayed playable in round 2 with nothing on the table to show it. Both
windows are now asserted to withhold their mode in round 2, with
`ids.length > 0` first so neither negative can hold against an empty list.

This is the answer to a standing worry about that kind of fix: a hoist is
untested until a card needs it in the second window, and the right time to
assert it is when such a card arrives.

## §5 — All green first time is a tell

Every one of the 14 assertions passed on the first run, which wave 77 had just
taught me to distrust. One of them was passing for the wrong reason.

**"The second Sideslip is not offered"** walked back to
`combat.damageResolution` after the first had resolved. But M's hand strike
deals 1, Sideslip prevents 1, `pendingDamage` empties and **the window closes**
— so the walk found no window, returned an empty list, and "the second copy is
absent" held against nothing at all. The once-per-round limit was never tested.

The fix is to make M hit for 3, so a point is still pending after the first
prevention, plus an `expect(after).toContain("pass")` so the window is *shown*
to be open before anything is said to be missing from it.

Same lesson as wave 76's dodge that never happened, in a different costume:
**a negative assertion needs the thing it is negating to have been possible.**
