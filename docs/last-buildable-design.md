# The last buildable four

**Cards:** Fiendish Tongue (100726), Revelations (101627), Deep Song
(100515), Revolutionary Council (101631).

**After this wave, every buildable library card is supported.** What is
left is exactly the blocked set — 14 wraith/zombie, 4 Path, 2 token
vampire — so the next wave is a decision, not a survey.

The four have nothing in common but that: they are the singles the queue
listed, each with its own small design. Political Action finishes at zero
and Action finishes at four (2 wraith/zombie, 2 token vampire).

---

## 1. Fiendish Tongue — a rider that outlives its own card

> Requires a Sabbat vampire. Ⓓ Bleed with +1 bleed. Anarchs get −1
> intercept during this action. If this vampire is Tzimisce and the bleed
> is successful, this Tzimisce can burn 1 blood during your next discard
> phase to unlock.

The first two clauses are data. **"Anarchs get −1 intercept" is
`modifyFilteredIntercept` with a sect arm** — the primitive built for
Perfect Paragon, whose filter carried `kinds` and `younger` but not
`sects`. `blockerMatchesFilter` stays a **union** (the recorded reading:
the English "and" in "allies and younger vampires" names two groups), and
a filter with one arm is unaffected by that either way.

It is registered **at announcement**, in the loop `blockRestriction` and
`actorCombatRider` already live in. That loop exists because of the bug
the bleed-riders sweep found: an effect that shapes the block window,
registered in `resolveCardAction`, never applies in exactly the case it
is written for, because a blocked action never resolves.

**The third clause is the interesting one: the permission outlives the
card.** The action card is burned at resolution (p. 27), so by the time
the discard phase arrives there is no card in play to hang an ability on,
and no handler is enumerated for a minion. So the permission lives on the
minion — **`MinionState.discardPhaseUnlock`**, set in `resolveCardAction`
(which runs only on success, and whose `bleedOk` guard already means "the
bleed was for 1 or more") — and the option is a **built-in**, the way
`unlock:blood` and `press:continue` are built-ins for credits granted by
a card that is no longer being played.

Two readings on record:

- **It does not consume a discard phase action.** p. 37 gives one such
  action by default, and the card does not say "discard phase action" —
  the Judgment: Camarilla Segregation precedent, where the absence of the
  phrase was decisive in the other direction.
- **The permission expires with the turn.** "Your NEXT discard phase" is
  one chance; the flag is cleared on `TurnBegan` beside `bledThisTurn`,
  and the bleed necessarily happened earlier in the same turn, because an
  action card can only be played in your own minion phase.

---

## 2. Revelations — the first card that reveals hidden information

> +1 stealth action.
> [aus] Ⓓ Look at your prey's hand and discard one card of your choice
> from it.
> [AUS] Put this card in play. Your prey plays with an open hand. Any
> minion can burn this card as a Ⓓ action.

**This card makes a recorded gap real for the first time.** CLAUDE.md has
carried this line since `PlayerView` was completed:

> Still unmodelled and required before phase 6 ships: "who has looked at
> this card" — an effect that reveals a hand or library top means that
> player keeps knowing those cards, which structural masking cannot
> express. **No implemented card reveals hidden information yet, so
> nothing is wrong today.**

That last clause stops being true here. The two halves are not equally
hard, and the difference is the same one the retainer wave drew for Owl
Companion:

- **The superior is structural and continuous** — "your prey plays with
  an open hand" is true exactly while the card is in play, which is what
  masking is *good* at. It is one term added to **`openHandsFor`**, which
  already defeats both masking layers (`redactFor` hides names, `viewFor`
  collapses to a count) and already derives the answer on every read
  rather than storing it. "Prey" is derived too, so an oust that changes
  who your prey is moves the effect with no bookkeeping.
- **The basic is a MOMENTARY reveal, and its memory is the gap.** The
  library-search wave settled the shape: *the option list IS the search*.
  The prey's hand appears only inside a ChoiceFrame addressed to the
  acting seat, and the event log records only what was **discarded**,
  never what was seen. So nothing leaks to the table, and a replay
  reproduces the game. What is not expressible is that the actor now
  *knows* the cards they did not take — for a hotseat game the human
  simply remembers, and for phase 5 an AI seat will not.

**Recorded, not deferred:** the basic mode is honestly supported (it does
exactly what the card says at the moment it says it), and the memory gap
is a property of `PlayerView`, not of this card. It is in
`docs/partial-support.md` under the deliberate-simplification heading so
that the phase-6 work has a card to point at.

"Any minion can burn this card as a Ⓓ action" is `vulnerableTo` with
`who: { scope: "any" }`, unchanged since the granted-actions gate.

`putsInPlayOnSuccess` had to start carrying **statics** — it hard-coded
`statics: {}`, which was invisible while every one of its ten users had
none.

---

## 3. Deep Song superior — and the deferral was bigger than the card

> [ani] Ⓓ Bleed with +1 bleed.
> [ANI] Frenzy. Ⓓ Enter combat with and lock a vampire. The target
> vampire is considered the acting minion during that combat.

The ledger has carried "**it INVERTS combat roles**" as a blocker for
five waves. **The inversion is the two arguments to `pushCombat` in the
other order.** A rush pushes its combat at exactly one site, in
`finishAction`, and everything that reads "the acting minion of this
combat" reads `cf.acting` — so a frame built with the roles swapped *is*
the inverted combat. `ActionFrame.invertCombatRoles` carries the flag
from announcement to that one push.

That is the **fifth** cut-list row in eight waves whose blocker had
already been built or was cheaper than written down (Touch of Valeren, New
Carthage, Break the Bonds, Hunting the Quarry, Spying Mission — and now
this). The rule stands: **a deferral is a claim about the code as it was.**

What the swap actually buys, and why it matters rather than being
cosmetic: the acting side chooses its strike first; actor-side riders
(`actorCombatRider`) apply to `acting` and blocker riders to `opposing`;
and `cf.fromBlock` is false either way. A card that says "the acting
minion" now means the target.

**"…and lock a vampire"** is a plain `MinionLocked` on success, and it
sits well with the inversion: an acting minion is normally locked at
announcement (p. 25), so the vampire being *treated* as the acting minion
ends up locked like one.

**The frenzy classification test had to be rescoped, and that is the same
lesson as the keyword test two waves ago.** `frenzyTargetSide` answers
"which combatant is this frenzy card used ON", which Tranquility Shield's
immunity and Meditative Grove's cancel both ask — and both are combat
questions. Deep Song is an **action** card that happens to carry the
frenzy keyword, played before any combat exists, so it has no side to
classify and no shield can reach it. The test now walks the frenzy specs
that are combat cards, and asserts separately that Deep Song is a frenzy
card which is not one. **An assertion about a total set is a hostage to
every future card**; scoping it to the question it is really asking is
what keeps it honest.

---

## 4. Revolutionary Council — a heterogeneous allocation

> Requires a baron. Choose X ready unlocked Anarchs you control and
> allocate 2X points among one or more Methuselahs, locations, and
> equipment. Successful referendum means each chosen Anarch is locked,
> each Methuselah burns 1 pool for each point allocated, and each location
> or equipment allocated a point is burned.

`enumerateAllocations` ranges over one homogeneous list of uncapped
recipients. Two things are new:

- **Caps.** A location or equipment is *burned* by a point, so a second
  point on it is wasted. Passing a per-target cap of 1 for cards and none
  for Methuselahs is what keeps the option list finite in practice as
  well as correct: it is the difference between "8 points over 6 targets"
  and "8 points over 3 targets plus a subset of 3 cards".
- **X is part of the terms.** The chosen Anarchs decide how many points
  there are, so the option carries both halves — `terms:<anarchs>:<alloc>`
  — and one option is emitted per (subset, allocation) pair. Terms are
  chosen only on success (p. 27), and every answer rides in the option id,
  so no ChoiceFrame is needed.

**Reading on record: the points must all be allocated.** "Allocate 2X
points among one or more Methuselahs, locations, and equipment" names a
number and a minimum set, and Methuselahs are uncapped, so there is always
a legal way to place them all — unlike Amici Noctis, where every recipient
was capped and "distribute" therefore could not be exhausted.

**The caller is never one of the chosen.** It locked at announcement
(p. 25), and the card says "ready **unlocked** Anarchs", so the pool is the
caller's *other* Anarchs. That falls out of the model rather than needing a
rule, and a test pins it — it is the sort of thing a reader would otherwise
assume was a bug.

**`requiresTitle: ["baron"]`** is the existing named-title requirement, not
last wave's `requiresTitled`: the card names one title.

**Measured, and worth knowing: this is the largest option list in the
engine.** Four choosable Anarchs and four locations produce **2168** legal
terms — every (subset of Anarchs × allocation of 2X points) pair. That is
the card's actual legal space, not an enumeration bug, and the caps are
what keep it to four figures rather than five. The fuzz handles it. If it
ever needs cutting, the move is a *sequence* of ChoiceFrames at the terms
step (the `unlockToll` shape, one unit at a time) rather than a cap on
what is legal — but that means the terms stop being one decision, which
p. 27 does not require but every other political card assumes.

---

## 5. What this wave did not need

`vulnerableTo`, `putInPlayOnSuccess`, `openHandsFor`, `discardFromHand`,
`modifyFilteredIntercept`, the announcement-time rider loop,
`enumerateAllocations`, `raiseChoice` and the rush push were all built by
earlier waves. The genuinely new pieces are `MinionState.discardPhaseUnlock`
with its built-in option, a `sects` arm on the intercept filter,
`PermanentStatics.opensPreyHand`, `ActionFrame.invertCombatRoles`, and
per-target caps on `enumerateAllocations`.
