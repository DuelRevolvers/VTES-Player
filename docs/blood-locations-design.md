# Hunting grounds and the other locations that feed blood

*Carfax Abbey (100297), Papillon (101350), Meditative Grove (102252),
Cappadocian Crypt (102298), The Hungry Coyote (100945).*

## 1. The cluster

Master is the largest unsupported family (27) and had gone several waves
without a sweep. The tightest group inside it is the one that finishes a
family already built: **thirteen generic hunting grounds are supported**
off a single `permanent.huntingGround` mechanic, and the three that are
not each add exactly one twist. Two more locations join them because they
answer the same question — *how does a Methuselah put blood on a
vampire?* — from different windows.

| Card | The twist |
|---|---|
| Carfax Abbey | a **second** grant, if you control a ready baron |
| Papillon | 2 blood, and only to a **titled** vampire (requires a **city title** to play) |
| Meditative Grove | clan-filtered, **plus** a frenzy cancel |
| Cappadocian Crypt | not a hunting ground: lock **after a successful action requiring Hecata or `[obl]`** |
| The Hungry Coyote | not a grant at all: "**Sabbat vampires you control get +1 hunt**" |

## 2. A "city title" is derived, not guessed

> Papillon: "Requires a ready vampire with a **city title**."

The V5 rulebook never lists the city titles under that name, but it says
which titles are city-associated, three times: the Camarilla **prince**
"is associated with a particular city and can be contested by another
vampire who claims any title to the same city" (p. 40); the Anarch
**baron** "is associated with a particular city" (p. 39–40); and, "like
Camarilla princes, the title of **archbishop** is associated with a
particular city" (p. 40). Every other title it names is explicitly *not*
unique and cannot be contested.

The card pool agrees, and that is the check that makes this safe rather
than clever: of the V5 crypt, **only** prince, baron and archbishop print
"of ⟨city⟩" — `Camarilla Prince of Melbourne`, `Anarch Baron of Helsinki`,
`Sabbat Archbishop of Gdansk` — while `Camarilla primogen`, `Sabbat
bishop`, `Sabbat cardinal` and `Sabbat priscus` never do. `CITY_TITLES` in
state.ts records the three, and a test in
`tests/cards/blood-locations.test.ts` re-derives them from the registry so
the constant cannot rot the way the "Assamite" clan filter did.

## 3. The hunting-ground mechanic grows three knobs

`permanent.huntingGround` was `{ amount, clan? }`. It gains:

- **`sect`** — "a ready **Anarch** you control" (Carfax Abbey). The
  sibling of the existing `clan`, and the same one-line filter.
- **`title`** — `"any"` (Papillon: "a ready **titled** vampire") or
  `"city"`, reading `CITY_TITLES`.
- **`extraIfControlsTitle`** — Carfax Abbey's *"and, if you control a
  ready baron, another ready Anarch you control can gain 1 blood as
  well."*

That last one broke the existing gate. One hunting ground was one use per
turn, enforced by the boolean `PermanentInPlay.usedThisPhase`; Carfax
Abbey allows **two**, so the entry needs a count.
**`PermanentInPlay.phaseUses`** is an optional number reset beside
`usedThisPhase` in the unlock sweep, and the hunting-ground gate compares
it against an allowance that is 1, or 2 while the condition holds.

`usedThisPhase` is deliberately left alone rather than widened: every
other "during X, do Y" latch in the engine means it, and changing its type
would touch a dozen unrelated cards to serve one.

**The per-VAMPIRE limit is untouched.** "A vampire can gain blood from
only one hunting ground each turn" is `MinionState.usedHuntingGroundThisTurn`
and already covers the second grant for free: it is the same location, so
the same vampire cannot take both — which is exactly what "another ready
Anarch" says.

## 4. "+1 hunt" — the hunt amount was a constant

> The Hungry Coyote: "Sabbat vampires you control get +1 hunt."

A hunt gains 1 blood (p. 21), and the engine said so with a literal `1` in
the hunt-resolution branch. `huntAmountFor(state, minion)` in derived.ts
is that literal plus `aura.hunt`, alongside the `aura.cannotHunt` that
Week of Nightmares already added — so the aura system now covers both
"they hunt for more" and "they do not hunt".

This is the smallest possible change and it is the right shape: the aura
is already filtered by clan, sect and controller scope, and "+1 hunt" is a
persistent trait of the minion, not a property of the action.

## 5. Cappadocian Crypt: a lock keyed on what the action REQUIRED

> "You can lock this location **after resolution of a successful action
> requiring Hecata or Oblivion `[obl]`** to add 1 blood to a Hecata you
> control."

Both halves of the window already exist. `action.afterResolution` was
built in `docs/after-resolution-design.md` (with
`ActionFrame.resolvedSuccess`), and "which Disciplines does this card
require" is `CardHandler.requiresDisciplines`, built for
`docs/discipline-filtered-design.md` and reused by the play-cost gate.

What is missing is the clan half: **`CardHandler.requiresClans`**, added
centrally in `compileSpec` from `spec.requiresClan` exactly as `costTypes`
and `requiresDisciplines` were. That is the fifth wave running where a
central query built for one family turns the next one into data — and it
is added centrally *for the same reason as last time*: a hand-rolled
handler that answers `undefined` silently fails the filter, which is how
Secure Haven came to skip Blood Doll (CLAUDE.md). `backfillCentralQueries`
gets the same default.

The ability is **`permanent.afterActionBlood`, its own clause rather than
another `lockGrant` knob.** `lockGrant` has grown eleven knobs across three
waves, and every one of them grants a measurable bonus *to an action in
flight*; this one fires once the action is over and moves blood. Bolting
it on would have stretched that structure past its meaning.

**`anyAfterResolutionPlay` had to learn about cards in play.** The
after-resolution window opens only if some seat can actually use it, and
the probe asked `handlerOptions` (cards in HAND) alone — so a window whose
only user is a location would never have opened, and Cappadocian Crypt
would have been marked supported and been unreachable. That is the
recurring failure of a question asked in two places where only one learns
about a new case (`modifyVotes`/`restrictVotes`/Scalpel Tongue), so the
two probes now share one body, `anyPlayIn(window)`.

## 6. Meditative Grove closes the frenzy gate

> "You can lock this card to **cancel a frenzy card as it is played** on a
> Salubri you control (**cost is still paid**)."

`docs/frenzy-design.md` deferred this and Tranquility Shield together; the
round-recurring wave built the piece both were missing —
`CardPlayFrame.isFrenzy` and `frenzyTargetSide`, which answers *which
combatant a frenzy card is used ON* from the mode's own effects rather
than from a list of card names. This card asks the same question from a
different window.

Two things had to give:

- **`abilityOptionsFor` returns `[]` in `card.asPlayed`** — "only cancels
  and wakes there, p. 7". That rule is right, and this card is a cancel,
  so the exception is opt-in per handler
  (**`CardHandler.abilityInAsPlayed`**), the shape `abilityAnySeat`
  established when The Barrens turned out to be enumerable by every
  Methuselah. Default behaviour is unchanged and the exception is
  greppable.
- **The ability needs the pending card.** `abilityOptionsFor` built its
  `PlayContext` with `pendingCard: null`; it now fills it the same way
  `handlerOptions` does.

**"Used on" is DENORMALIZED, not looked up.** The first attempt read the
frenzy card's spec back by name to re-run `frenzyTargetSide` — which does
not even compile, since `specByName` lives in cards.ts and cards.ts
imports compile.ts. The right shape was the one the engine already uses
for `isMaster`/`isCombat`/`isFrenzy`: a central query
(`CardHandler.frenzyTargetsOpponent`, derived from the mode's effects in
`compileSpec`) stamped onto **`CardPlayFrame.frenzyOnOpponent`** when the
frame is pushed. A card never reads another card's spec; it reads a
boolean on the frame in front of it.

"**Cost is still paid**" is `cancelPendingCard(false)` — the flag Sudden
Reversal already distinguishes. And the location **locks**, so a second
frenzy card in the same combat gets through.

## 7. A pre-existing bug this wave found

**`requiresControlledTitle` was read in exactly one place.** It is the
"Requires a prince / justicar / …" line, a condition on the METHUSELAH
rather than on any acting minion, and it was checked only in the
polling-step branch that Closed Session and Private Audience use. The
master compiler checked its two siblings (`requiresControlledSect`,
`requiresControlledClan`) and not this one, and the action compiler
checked none of the three — so **Expulsion's "Requires a prince or
primogen" was unenforced**, and Papillon's would have been.

That is the `meetsRequirements` bug from CLAUDE.md, again: a requirement
line checked at some sites and not others, and **structurally invisible to
the fuzz**, which plays whatever it is offered — a too-permissive option
list looks exactly like a correct one. All three clauses now go through
one `controllerMeetsRequirements` helper, called from the master
compiler, the action compiler and the polling branch.

## 8. Rulebook citations

- p. 7 — the as-played window: only cancels and wakes.
- p. 16 — "during X, do Y" is once per phase.
- p. 17 — the unlock phase unlocks all of your cards.
- p. 21 — hunting: the action, and gaining 1 blood.
- p. 28 — titles and the votes they carry.
- p. 32 — the frenzy keyword.
- p. 39–40 — which titles belong to which sect, and which are associated
  with a particular city (§2).

## 9. Readings on record

1. **"A vampire can gain blood from only one hunting ground each turn"
   binds the second grant too** — Carfax Abbey's extra use is the same
   location, so it must go to a different vampire. The card says "another
   ready Anarch", which is the same conclusion from the other direction.
2. **Papillon's requirement and its grant are different tests.** "Requires
   a ready vampire with a **city** title" gates playing the card; "a ready
   **titled** vampire you control can gain 2 blood" is the grant, and any
   title qualifies. Two clauses, two filters — not one.
3. **The Hungry Coyote's bonus is a trait, not an action modifier.** It is
   an aura on the minion, so it applies to every hunt they make, including
   a hunt granted by another card.
