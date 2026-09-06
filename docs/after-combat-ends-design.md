# After combat ends

Status: **design + implementation** (2026-08-31). Chosen by pool survey;
Combat is the largest remaining family after Master, and this is its most
coherent cluster.

## 1. The shape

Four cards whose superior mode is "**Strike: combat ends**" *plus a rider
that happens once the combat is over*. The engine had no place to put such
a rider: `strikeCombatEnds` set a flag and the frame popped.

| id | card | the rider |
|---|---|---|
| 100307 | Catatonic Fear | if the range is close, 1 **unpreventable** damage to the opposing minion |
| 102279 | Pass Through Shadow | put this card **on this vampire**; they can burn it for +1 stealth |
| 100771 | Form of Mist | if this vampire was blocked, they may burn 1 blood to **continue the action as if unblocked**, +1 stealth |
| 102330 | Kiss of Cathari | "**stun** the opposing minion" — **DEFERRED, §5** |

Also in this wave, from the same window but not the same clause:
**Rolling with the Punches** (101649), whose superior prevents *all damage
from the opposing minion's strikes this round* — round-scoped prevention,
which the engine also lacked.

## 2. `CombatFrame.afterCombatEnds`

A list of riders, applied where `notifyCombatEnded` already runs — i.e.
**after the frame is popped**. That placement is not incidental: the
archetypes wave learned that a hook fired before a frame's own `pop()`
has any ChoiceFrame it raises eaten by that pop, which hangs the settle
loop. The captured frame object still reads fine once off the stack, so
the riders can consult the range and the combatants.

**The range is read from the captured frame**, which is what "if the range
is close" means: the range as combat ended, not some later state.

## 3. Form of Mist — the one that needed a ruling

"After combat ends, if this vampire was blocked, they can burn 1 blood to
continue the action with +1 stealth **as if unblocked, even if stealth is
not yet needed**."

A blocked action sits at `ActionFrame.step = "blocked"` and `settle`
resolves it as a failure once combat pops. Continuing it means putting the
action back into a state that can still resolve. The question is *which*
state — and the card answers it itself:

**Reading on record: it returns to state A, where blocks may still be
declared.** The clause grants +1 stealth "even if stealth is not yet
needed", and stealth is only ever worth anything while somebody may still
block. Returning to state C — after blocks — would make that half of the
card text dead letter. So `blockedBy` is cleared, `step` goes back to
`"A"`, and the +1 stealth is emitted as an ordinary `StealthModified`.

The minion that blocked is locked and has spent its attempt; its
Methuselah may try again with another minion, which is what "as if
unblocked" says. **Flagged for owner review** — it is a reading, not a
citation.

`oncePerActionAtSuperior` is new and small: "a vampire can play only one
Form of Mist at superior each action" is the per-action sibling of
`oncePerCombatAtSuperior` (Terror Frenzy), recorded the same way.

## 4. Round-scoped prevention

Rolling with the Punches superior prevents "all damage from the opposing
minion's strikes **this round**" — not the one pending item that
`preventAll` handles. `CombatFrame.preventAllFrom` is a per-side flag
reset with the other per-round state, checked in **`pushPendingDamage`**,
the single chokepoint Dawn Operation established. Damage from that side is
turned into a `DamagePrevented` event and never enters the queue.

Doing it at the chokepoint rather than in the prevention window matters:
it catches retainer output and `combatRoundDamage` statics too, which a
window-time check would miss.

## 5. DEFERRED — "stun" is undefined, and needs an owner ruling

**Kiss of Cathari** (102330) and **Mind Numb** (101211) both say "stun",
and:

- **the word does not appear anywhere in the V5 rulebook** (checked by
  full-text search of the PDF);
- **no card in the V5 pool defines it** — those two are the only cards
  that use it, and neither explains it.

So there is nothing to implement it against without inventing a rule.
Both cards are left unsupported and the question goes to the owner:
*what does "stun the opposing minion" do?* A plausible guess is "the
minion does not unlock as normal during their controller's next unlock
phase" — `MinionState.skipNextUnlock` already exists and would cost one
line — but that is a guess, and guessing a keyword's meaning is exactly
the kind of invention this project keeps out of the engine.
