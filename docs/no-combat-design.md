# Blocked, but no combat

Tranche 3, wave 30. Library **606 → 609**. Three cards that replace the
**second consequence** of a successful block (p. 27): the blocker locks,
*and the minions enter combat*. These leave the first and cancel the
second.

| Card | KRCG | Printed |
|---|---:|---|
| Clan Loyalty | 100354 | Only when blocked by a vampire of the **same clan** (play before combat). **Cancel the block and combat.** The action continues as normal, and no vampires of that clan may block this vampire for the rest of the turn. |
| Ghoul Escort | 100817 | Ghoul, 4 life. When this vampire is blocked, **burn this retainer and unlock instead of entering combat**. (This does not unlock the blocker.) |
| Blood Brother Ambush | 100195 | Only when an action is blocked. **Combat does not occur.** Put this card into play as an ally with 3 life, 2 strength, strike 2R; **it** enters combat with the blocking minion. Burn it at the end of combat or if the combat is canceled. |

Ghoul Escort was deferred by wave 26 and is now built, under the owner's
standing rule: a missing mechanic is not a reason to defer a batch.

## §1 — A combat that never happened

`endCombatFromOutside` was the wrong tool. It jumps to **End of Round**,
which is right for a combat that *ended* — that step still runs (p. 32)
and every "after combat" rider hangs off it. Here there was no combat, so
`cancelCombat` drops the frame outright and emits **`CombatCancelled`**,
a separate event precisely so no `onCombatEnded` hook fires.

It takes the outcome the card names:

- **`continueAction`** (Clan Loyalty) — the block is *cancelled*, so the
  blocker is unlocked again (it locked when the block succeeded, and
  *"the blocking minion is not locked"* [ANK 20180321] is that lock being
  undone), `blockedBy` is cleared, and the action returns to **state A**:
  "continues as normal" means another minion may still try.
- **`actionBlocked`** (Ghoul Escort, Blood Brother Ambush) — the block
  stood and the action still fails. Only the fight is skipped, and "this
  does not unlock the blocker" is simply not touching them.

**Where they are played.** All three are "play before combat", which in
this engine is the first window of the combat the block produced — the
same window `afterBlockResolution` cards (Cats' Guidance) already use.
That window's existing branch serves the *blocker*; these get a sibling
branch serving the **acting** seat. `effectsLegal` refuses
`cancelBlockCombat` outright, so the generic modifier path cannot offer
them in an ordinary action window where there is no block to cancel.

## §2 — A block bar that outlives its action

*"No vampires of that clan may block the acting vampire for the remainder
of the turn."* Every other block restriction lives on
`ActionFrame.blockRestrictions` and dies with the action. This one lives
on the **turn** frame (`clanBlockBars`), keyed by the acting minion and
the clan, and is consulted by the same block-eligibility generator.

## §3 — A card that becomes a minion mid-combat

Blood Brother Ambush cancels one combat and starts another, with itself
as a combatant. Three pieces:

- **`allyEntry` is no longer the ally compiler's alone.** The stats
  question ("3 life, 2 strength, plays Potence as a 3-capacity vampire")
  is the same one an ally card answers, so it moved to a shared
  `allyEntryFor(spec)` and the modifier compiler exposes it when the spec
  has `ally`.
- **The ash heap needed no change.** The resolution path already files a
  played card *"only if it did not go INTO PLAY instead"*, testing
  `allEntries()` — and the new ally is an entry.
- **"Burn this card at the end of combat OR IF THE COMBAT IS CANCELED"**
  is one check (`burnAtCombatEnd`) called from both the `CombatEnded`
  site and `cancelCombat`, because it is one sentence.

*"If a card would give them blood, give them life instead"* needs no
code: an ally's life **is** its blood field in this engine (p. 11).

## What the wave found

**Two apply switches, not one.** The compiler has separate effect-
resolution switches for combat cards and for modifiers/reactions. The new
case went into the combat one, so Clan Loyalty played, paid its blood,
emitted `CardResolved` — and did nothing. Nothing warns about this: an
effect kind missing from a switch is a silent no-op in the switch that
never sees it.

**An unrestricted modifier is offered in the ordinary action window.**
Before the `effectsLegal` refusal, Clan Loyalty was offered *during the
block attempt*, where cancelling a combat means nothing. The negative-
space test (different clan, must not be offered) caught it — it was
passing through a path that never reached the clan check.

## Deviation on record

Clan Loyalty and Blood Brother Ambush print as **Action Modifiers** and
are compiled as such, but they are only ever offered in a combat window.
Nothing in the pool filters on "combat card" in a way that could see the
difference; if such a card is built, this is the place to check.

## Tests

`tests/cards/no-combat.test.ts`, 4 tests, one negative: Clan Loyalty is
not offered when the blocker is a different clan. The Ghoul Escort test
asserts both halves of its parenthetical — the actor unlocked, the
blocker still locked.
