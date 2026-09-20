# Churning the hand

Wave 70 (2026-09-19). Deal with the Devil (100506), Lupine Assault (101133),
Specialization (101842), Servitor of Irad (101729).

Four cards whose whole effect is on **hands** rather than on the board: one
throws its own away, one throws everybody's away, one sells a duplicate, one
draws off somebody else's Gehenna card. The interesting part of all four is
**order** — when the replacement draw happens relative to the effect.

---

## §1 — The one shared op

`drawUpToHandSize(seat)` refills to `handSizeOf`, so every temporary grant in
force counts (Ennoia's Theater's +1, Dreams of the Sphinx's +2) and an empty
library simply stops. The loop re-reads the hand each time rather than
counting once, because a draw can redirect (Black Market Cache).

## §2 — Deal with the Devil: the replacement must wait

> "Discard your hand and draw a new one. **Do not replace this card until
> after you discard your hand.**"

A card played from hand is normally replaced *at once*, before it resolves —
so the fresh replacement would land in the hand this card is about to throw
away. That is the only reason the clause is printed.

`delayedReplace: "afterResolve"` is the new variant: the replacement is drawn
in `resolveCardPlay`, once the card's own effect is done. Two readings
recorded:

- **`afterAction` does not work here.** That branch requires an action frame,
  and a master has none, so the chain falls through to the immediate draw —
  the exact bug the clause exists to prevent. A card type without the frame a
  deferral names gets no deferral at all.
- **"Replacement" means bringing the hand back to SIZE**, not "draw one".
  `afterResolve` calls `drawUpToHandSize`, because this card's own effect has
  already drawn a new hand and a flat extra draw left it one card **over**
  size (the first version of this test caught exactly that: 8 cards).

## §3 — Specialization: a question about the hand's SHAPE

> "During your unlock phase, you may lock this card and discard **two copies
> of the same card** from your hand to gain 1 pool (draw afterward)."

The only card in the pool that reads a DUPLICATE. The option list is one entry
per NAME the hand holds twice — the two copies are not a choice, because any
two copies of one name are the same two cards. The apply re-reads the hand,
since it can change between the offer and the lock.

"(Draw afterward)" is the ordinary replacement for a discarded card — a
parenthetical describing existing behaviour, which is the shape this project
has now seen six times.

## §4 — Lupine Assault: everybody's hand, everybody's choice

> "Each Methuselah (including you) discards 5 cards of his or her choice, then
> draws back up to his or her hand size. **Only one Lupine Assault may be
> played in a game.**"

One choice frame per standing seat, re-raised while any discards are owed —
the `unlockToll` shape, because each answer changes the hand the next option
list is computed from. The refill fires when the count runs out **or when the
hand does**, so a seat with three cards discards three and refills.

**What it found: `oncePerGameByName` was honoured by ONE card type.** The flag
has existed since wave 61 and is checked inside the political-action
compiler's own enumerator — so a MASTER or an action card carrying it could be
played twice, silently. The bar now lives in the engine's single hand-play
enumerator (`handler.oncePerGameName`), which every card type flows through;
the political copy stays, narrower, because a political action reaches its
enumerator by its own path. **When you add a flag to a FAMILY, check which
compiler reads it** — this is the fourth flag found living in one type's
compiler when it meant every type.

## §5 — Servitor of Irad: a hook on somebody else's play

> "After **any Methuselah** plays a Gehenna card, you may draw two additional
> cards from your library **if this vampire is ready**. Discard down to your
> hand size afterward."

`onGehennaPlayed` fires for every card in play from the one place the engine
already noticed a Gehenna card being played (the same site that clears the
diablerist exemption). The draw belongs to the BEARER's controller, not to
whoever played the Gehenna card.

"You may" with no cost is **taken**: the project's line is that a costless,
purely beneficial option is taken (Show of Force) while a priced one is asked
(Cave of Apples). The discard-down that follows is asked, because which cards
to lose is a real choice.

## §6 — The trap this wave hit twice

`addLocationAbilities` early-returns unless one of its gate fields is present,
and **two of this wave's fields were added without being added to that gate**
— so the ability enumerated nothing and the hook was never installed, with
nothing to see in a stack trace. It cost a debugging round in wave 69
(`burnTorpid`) and another here (`gehennaDraw`).

The related self-inflicted lesson: several patches this wave and last were
applied with shell string-replacement, and **a replace whose anchor has
drifted is a silent no-op**. CLAUDE.md already says to edit source with the
file-editing tools; the reason is exactly this, and it cost two rounds of
chasing a "missing" behaviour that had never been written.
