# Cards in play that change what OTHERS may do to you

*Perfect Paragon (101387), Stolen Police Cruiser (101872), Archon
(100084), Raising the Portcullis (102303), Haqim's Law: Retribution
(102226).*

**The cluster was found by reading two cards' text side by side.**
`docs/partial-support.md` had carried Stolen Police Cruiser as cut for
two waves, blocked on:

> "Allies and younger vampires get −1 intercept against this Anarch" — a
> PERSISTENT intercept penalty keyed on the blocker's kind and capacity.
> `modifyAllIntercept` is action-scoped and the aura system has no
> intercept field.

That is accurate — and **Perfect Paragon's superior prints the identical
sentence, action-scoped**. One filter, two lifetimes, which is the shape
this engine keeps arriving at (`ActionFrame.blockCosts` vs
`alliesCannotBlock`; `modifyBleed` vs `aura.bleed`). Building it once
serves both, and Archon then wants the same treatment for a *block toll*.

## 1. "Allies and younger vampires" — and the "and" is a UNION

**`blockerMatchesFilter(blocker, actor, { kinds, youngerThan })`** in
derived.ts is the shared test, read from two places:

- **`ActionInterceptModified.filter`** — action-scoped, emitted by
  `modifyFilteredIntercept` (Perfect Paragon superior).
- **`PermanentStatics.opposingInterceptPenalty`** — persistent, carried
  by a card on the **acting** minion, so it holds for every action they
  take (Stolen Police Cruiser).

**Reading on record, and it is the one that matters: the English "and" is
a UNION of two sets, not an intersection.** "Allies **and** younger
vampires get −1 intercept" names two groups and applies to both; reading
it as an intersection would make it mean "younger allies", which is not
what either card says — and allies have no capacity to be younger *than*
in the first place, so the intersection reading would make the clause
nearly inert.

**"Younger" compares DERIVED capacity** (`capacityOf`), so a granted
point counts — the same reading `younger` takes everywhere else.

`currentIntercept` had to learn to look up **the acting minion**, which
it never did: it already read the action for conditional statics
(`Abbot`, `Guardian Angel`), so `actingMinionOf` joins that lookup rather
than adding a second one.

## 2. Archon — three clauses, three lifetimes

```
Requires a prince or justicar.
Choose a Camarilla vampire. Successful referendum means this card is put
  on the chosen vampire.
The attached vampire can enter combat with a vampire as a +1 stealth Ⓓ
  action.
Vampires attempting to block the attached vampire burn 1 blood.
Blood hunts cannot be called on the attached vampire.
Camarilla vampires can call a referendum to burn this card as a +1
  stealth political action.
```

- **`refAttachToChosen`** is `refPutInPlay` with a bearer chosen in the
  terms — the card is held aside at action resolution
  (`holdsCardForReferendum`, built for War of Ages) and attached on a
  pass. Its own later "burn this card" referendum is the **same card
  instance**, and `fromCardInPlay` is what tells the two apart, exactly
  as War of Ages established.
- The rush grant is `permanent.rushGrant` with `who.scope: "bearer"`.
- **`PermanentStatics.blockToll`** is the persistent twin of
  `ActionFrame.blockCosts`: `blockTollFor` now takes the acting minion
  and sums both. That one change gives the toll the whole block-tax
  gate's behaviour for free — an ally facing a toll printed in **blood**
  cannot pay it and therefore cannot attempt (p. 22), and the toll is
  paid to **attempt**, not to succeed.
- **`PermanentStatics.noBloodHunt`** is checked in `pushBloodHunt`, which
  **returns without pushing the referendum at all** rather than pushing
  one and discarding the result. A referendum nobody's vote can change is
  a decision with no consequence, and the engine's standing rule is not
  to open one (the damage-resolution deviation, the after-resolution
  window).

**Reading on record: the chosen vampire may be anyone's.** "Choose a
Camarilla vampire" names no controller, and the card is normally aimed at
an opponent — so the terms range over every seat's ready Camarilla
vampires.

**Stolen Police Cruiser's third clause needed one field, not a
mechanism**: `vulnerableTo.bearerPenalty` (`lock`, `skipNextUnlock`).
`MinionState.skipNextUnlock` was built for Toreador Grand Ball and has
been waiting for this card since. **Ordering that bites:** the bearer is
only findable *through* the entry, so the penalty is applied **before**
the burn — the Rewilding lesson ("read the controller before the burn, or
there is nobody to charge").

## 3. An aura whose condition reads ANOTHER seat's board

Raising the Portcullis: "**While your prey controls a vampire in
torpor**, vampires you control get +1 bleed."

`PermanentAura` has clan, sect and titled filters, all about the minion
receiving the bonus. This is the first condition about somebody else
entirely, and it is **derived on every read** — `auraBonus` asks
`preyOf(controller)` when it sees the flag. Nothing is stored and nothing
is cleared, which is the same call the retainer wave made for
combat-scoped effects and for the same reason: the condition can stop
holding for reasons no code is watching (the prey's vampire leaves
torpor, the prey is ousted and a new one takes their place).

**"Your prey" moves.** Because it is derived, an oust that changes who
your prey is changes the aura on the next read, with nothing to update.

## 4. Haqim's Law: Retribution — and the legacy clan name again

"During a bleed action, an **Assamite** you control can discard a combat
card to get +1 bleed."

**"Assamite" is the legacy name and the registry says Banu Haqim** — the
Priority Contract trap, now for the fourth time (Priority Contract, Yoruba
Shrine, Wall Street Night's survey, this). The spec filters on
`"Banu Haqim"`, and `tests/cards/clan-vocabulary.test.ts` is the guard
that keeps it honest.

`permanent.discardForBleed` is the clause: the bleed bonus is emitted with
**`limited: false`** — the card does not print "(limited)", and p. 20's
one-limited-bonus rule is about action MODIFIER cards, where this is an
ability of a card in play (the Club Illusion reading). The discard is
**replaced** (p. 7).

## 5. What this wave does not do

**Revolutionary Council** (101631) is the last Political Action and stays
cut, with its blocker unchanged: it allocates 2X points over Methuselahs
*and* locations *and* equipment, and `enumerateAllocations` ranges over
one homogeneous list. That is a real extension, not a field.
