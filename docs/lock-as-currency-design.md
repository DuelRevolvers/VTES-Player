# The lock as currency

Tranche 3, wave 37. Library **627 → 630**. Three reactions in which the
**lock** is the price, the refund, or the thing being worked around.

| Card | KRCG | Printed |
|---|---:|---|
| Minor Irritation | 101221 | Only usable when this vampire successfully blocks an **ally or a younger vampire** (play before combat, if any). This vampire **doesn't lock for successfully blocking**. |
| Lost in Translation | 101126 | Only usable when an **ally or younger vampire** is bleeding you, after blocks are declined. **Lock this reacting vampire.** Choose another Methuselah other than the acting minion's controller. The acting minion is now bleeding that Methuselah. |
| Fillip | 100729 | **Usable by a locked vampire.** Choose a **younger locked vampire** you control. The chosen vampire can play reaction cards and attempt to block **as though unlocked** until the current action is concluded. A vampire may play only **one Fillip each turn**. |

Two of the three needed almost nothing. Lost in Translation is
`redirectBleed` with `lockSelf`, and the existing redirect enumerator
already excludes both the reacting seat and the **acting** seat — which is
exactly *"another Methuselah other than the acting minion's controller"*.
Fillip is a **wake**: `awake` is precisely "can react and block without
being unlocked" (p. 44), already scoped to the action, so `wakeOther`
needed one new `who`.

## §1 — A lock that is undone, not suppressed

*"This vampire doesn't lock for successfully blocking"* reads like a
suppression, but the card is played **after** the block resolved — p. 27's
two consequences (the blocker locks, combat begins) are simultaneous, and
this window is the first one of the combat they produced. So the card is
an **undo**: emit `MinionUnlocked`. Writing it as a flag consulted at
block resolution would need the card to be playable before it is legal to
play.

**The window's enumerator never asked a card's own conditions.** The
`afterBlockResolution` branch finds the mode carrying the rule, checks the
blocker is locked and can pay, and hands back the option — which was right
while every card reaching it was unconditional (Cats' Guidance, Forced
Vigilance). Minor Irritation is the first with a condition, and it was
offered against anybody.

The fix is **not** a wholesale `effectsLegal` call, which was the first
attempt and broke Cats' Guidance immediately: the effect gates in that
function are written for **state A**, where `unlockAndAttemptBlock` is
legal and a combat has not started. Asked from inside the combat this
window lives in, they fail cards that are perfectly legal. The condition
is asked directly instead, and the reason is recorded at the call site so
the next person does not repeat the experiment.

## §2 — "An ally or younger vampire"

Two of the three cards use this phrase and it is one comparison with a
wrinkle: **an ally has no capacity to compare and always qualifies**, so
only a vampire is measured, and "younger" is strict (`>=` fails). Minor
Irritation's negative test is exactly the equal-capacity case.

## §3 — "Usable by" is not "Only usable by"

`byLockedMinion` means *"Only usable by a locked vampire"* and excludes an
unlocked one. Fillip prints *"Usable by a locked vampire"* — locked is
**allowed**, not required, and using the existing rule would have made the
card unplayable by the unlocked vampire who most wants it. Hence
`alsoByLockedMinion`, which widens the candidate filter instead of
narrowing it.

*"A vampire may play only one Fillip each turn"* is per **VAMPIRE**, so it
reads `playedSinceUnlock` — the minion's own history, cleared by the
unlock phase — rather than the seat-level `oncePerTurnAtSuperior`.

## What the wave found

**An enumerator that returns an option without asking the card.** Three
`afterBlockResolution` cards existed and none had a condition, so the
branch grew up never needing one; the gap was invisible until a fourth
card arrived. This is "`meetsRequirements` has now been forgotten FOUR
times" in a new location — **a specialised enumerator is a place where a
card's own conditions can go unasked**, and the pool's growth is what
finds them.

The near-miss is worth as much as the bug: the obvious fix (call the
general checker here too) is wrong, because that checker's gates assume a
different point in the sequence. **A shared helper is not automatically
safe to call from a new window.**

## What is left

**Coterie Tactics is deferred**: two vampires blocking as one, pooling
intercept, both locking, and then one chosen to be *the* blocker while the
other *"is still considered to have blocked"* [LSJ 20090509]. That is a
second blocker in the block-attempt frame, not a modifier on the first,
and it wants its own wave.

## Tests

`tests/cards/lock-as-currency.test.ts`, 4 tests. The negative one pins
§2: the same fixture stops offering Minor Irritation when the blocked
vampire's capacity equals the blocker's.
