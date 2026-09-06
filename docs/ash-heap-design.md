# The ash heap

*The zone, plus Shroud of Decay (102295), Psychophagia (102302), The Gate
of Acheron (102290), Garibaldi-Meucci Museum (100809), Putrescent
Sustenance (102335).*

**Owner decision, 2026-09-01: build it.** The ash heap had been BLOCKED
pending review since the roadmap was written. A survey while picking the
last Action wave found that **nine unsupported cards want it** — seven of
the sixteen remaining Actions plus a Master and an Ally — which made it
the single largest blocker in the pool, so the owner unblocked it rather
than let it keep gating waves.

## 1. What the rulebook says, verbatim

The V5 rulebook is unusually explicit about this zone, and every design
decision below is quoted rather than reasoned:

> **Burn:** "When a card is burned, it is placed into its **owner's** ash
> heap (discard pile). The ash heap **can be examined by any Methuselah at
> any time**." (p. 16)

> **Playing a Card:** "A card is played by announcing its effects, showing
> the card and placing it from the hand **in the ash heap upon
> resolution**." (p. 8)

> **Ash Heap:** "The discard pile. Cards that are burned or discarded are
> returned to their **owner's** ash heap. **An action that targets an ash
> heap is always considered to be UNDIRECTED.**" (glossary)

> **Burn** (glossary): "Move a card in play to the ash heap. A burned card
> goes to its owner's ash heap."

> **Removed from the game:** "While some cards and effects can retrieve
> cards from the ash heap, cards that are removed from the game cannot be
> retrieved or **affected in any way**." (p. 16)

> "If aggravated damage burns them, they go **directly to the ash heap**.
> They do not go through torpor first." (p. 34)

Four of those settle questions that would otherwise have been readings:
the zone is **public**, it is keyed on **owner** and not controller, an
action targeting one is **undirected**, and removal is a different fate
from burning.

## 2. The zone

**`SeatState.ashHeap?: CardInstance[]`** — optional, so every existing
fixture and saved command log is untouched. That is the `GameState.idSeq`
precedent, and it matters more here than usual: this field is added late
to a zone that half the engine can write to.

**It is keyed on the OWNER, not the controller.** p. 16 says so twice, and
the distinction is live: a location stolen with Powerbase: Montreal, or a
master played on another Methuselah's minion (p. 16), goes home to the
player whose deck it came from when it burns. `PermanentInPlay` already
carries both `owner` and `controller` for exactly this reason, so the
applier reads `owner`.

**Vampires are OUT OF SCOPE and this is deliberate.** p. 34 puts a burnt
vampire in the ash heap too, but a `MinionState` is not a `CardInstance`,
crypt cards are phase 7, and **no card in the V5 library pool retrieves a
burnt vampire** — the two that read vampires there (Rotting Behemoth,
Waters of Duat's search) are blocked on other things. Recorded here so the
next session does not mistake the omission for an oversight.

## 3. The four ways in, and the one that has to be conditional

A card reaches the ash heap from four places, and three of them are
unambiguous:

| Event | Owner from | Note |
|---|---|---|
| `CardDiscarded` | `ev.seat` | discard from hand |
| `CardBurned` | `ev.seat` (new field) | an action card at resolution (p. 27); a held-back card whose condition missed |
| `PermanentBurned` | `entry.owner` | a card leaving play — read **before** the entry is filtered out |
| `CardResolved` | `ev.seat` (new field) | **conditional** |

**`CardResolved` is the one that needs a condition**, and getting it wrong
double-files: a master that *enters play* also emits `CardResolved`, and
would then be filed again when it is later burnt. So the applier files a
resolved card only when it is **not now in play** — answerable at applier
time, because `resolve()` has already run and put the permanent there.
Action cards are excluded too: they are burnt separately at action
resolution (p. 27), which is what `entered` already governs.

## 4. Removal from the game is a different sink

`MinionRemovedFromGame` was built last wave; this adds
**`CardRemovedFromGame`**, which *pulls a card out of an ash heap* and
files it nowhere. p. 16: removed cards "cannot be retrieved or affected in
any way", so there is deliberately no zone to put them in — the card
simply leaves the game state. Anything that counts cards must count what
it can see, not assume conservation.

## 5. "An action that targets an ash heap is always UNDIRECTED"

The glossary rule, and it is the one that saves work. Psychophagia,
Putrescent Sustenance and Shroud of Decay's superior all reach into
another Methuselah's ash heap, and every instinct built up over the rush
and steal waves says "target's controller ⇒ directed". The rulebook says
otherwise, explicitly, so `announceCardAction` passes **no** target seat
for these and **anyone may block** — which is a real difference, not a
technicality.

## 6. The cards

**Shroud of Decay** (102295) — full. `[obl]` bleed +1 with "target
Methuselah discards 2 cards of their choice" (a repeated ChoiceFrame
addressed to the *target*, the shape Fragment of the Book of Nod
established); `[OBL]` "remove 7 cards in your prey's ash heap from the
game to burn 3 of their pool" — enumerated only when there are 7 to
remove, since a card that provably cannot pay its own cost is not offered.

**Psychophagia** (102302) — full. A **+1 stealth hunt action** (the
`actionKind` matters: it is a hunt, so p. 21's rules apply) that removes
an ally card from *any* ash heap for 3 blood, or 2 blood and an unlock.
"An ally in an ash heap" is answered by **`CardHandler.costTypes`**, the
central query built for the play-cost wave — the sixth wave running where
an existing query turns the next family into data.

**The Gate of Acheron** (102290) — full. Counters, a Hecata granted
counter-action, `vulnerableTo`, and the payoff: "during your prey's unlock
phase, for each counter, **they** burn 1 pool **or** remove a library card
at random in their ash heap" — the choice belongs to the *prey*, so it is
a ChoiceFrame addressed to them, once per counter.

**Garibaldi-Meucci Museum** (100809) — full. "Exchange one card from your
hand for one card in your ash heap requiring an Anarch" needs a new
central query **`CardHandler.requiresSects`**, the exact sibling of
`requiresClans` and `requiresDisciplines`; the second clause is
`endCombatFromOutside`, built for the outside-the-combat gate.

**Putrescent Sustenance** (102335) — **PARTIAL**. Its "remove an ally in
an ash heap to gain 2 (sup: 3) blood" half works; "or add 2 life to a
zombie ally you control" is on the BLOCKED wraith/zombie list. Recorded in
`docs/partial-support.md` per the owner's standing instruction that a card
which cannot be finished goes on the partial or cut list rather than being
quietly dropped.

## 7. Still blocked, and now for a DIFFERENT reason

Two cards were on the cut list "because of the ash heap" and are not
unblocked by it — their rows are corrected rather than deleted, since a
stale blocker is what this project keeps tripping over:

- **Waters of Duat** (102159), **Childe of the Revolution** (102246) —
  their real blocker is that the card **becomes a 1-capacity vampire**: a
  token minion created from a library card, which the crypt/minion model
  has no notion of. The ash-heap half of their search is now available;
  the token vampire is a gate of its own.
- **Split the Veil** (102297), **Rotting Behemoth** (102304) — wraith and
  zombie allies, still BLOCKED pending owner review.

## 8. Readings on record

1. **The ash heap is public** (§1) — `redactFor` exposes every seat's,
   because p. 16 says any Methuselah may examine it at any time. It is the
   only zone in the game that is fully open.
2. **Filed by owner, not controller** (§2) — p. 16, twice.
3. **Burnt vampires are not modelled** (§2) — deliberate, no card needs
   them.
4. **An ash-heap action is undirected** (§5) — the glossary, against every
   other targeting instinct in this engine.
5. **A card removed from the game leaves the state entirely** (§4) — there
   is no "removed" zone to hold it, because nothing may affect it.
