# What a referendum chooses, and who pays

*Anarch Salon (100056), Consanguineous Boon (100410), Cold War (102312),
Disputed Territory (100557), Camarilla's Iron Fist (102270).*

**Political Action has never had a per-card wave.** The politics kernel
(`docs/politics-design.md`) and every gate on it — ballots, polling
votes, the abstain gate, the margin window, politics locations — are
closed, so what is left is the per-card tail, and it is almost entirely
**terms**: what the caller chooses when the referendum is announced, and
what a passed vote does with it.

The shape is settled and these five slot into it: one
`EffectPrimitive` per referendum, `referendumTerms` enumerating the legal
choices and `applyReferendum` cashing them in. **No frame changes, no new
windows.** The interest is in what the terms may range over — which is
four things the existing primitives could not say.

| Card | Chooses | Pays |
|---|---|---|
| **Anarch Salon** | nothing | every ready Anarch +1 blood; every Methuselah controlling one +1 pool |
| **Consanguineous Boon** | **a clan** | every Methuselah +1 pool per vampire of that clan |
| **Cold War** | a Methuselah **or** a location — **or both**, if the caller is a cardinal or regent | 3 pool / burn the location |
| **Disputed Territory** | a location **and** a Methuselah | the chosen Methuselah takes control of it |
| **Camarilla's Iron Fist** | a Methuselah **and** an allocation of 5 among two or more *others* | those burn 1 pool per point; the chosen one gains 1 |

## 1. "Choose a clan" — and the rulebook says which clans

Consanguineous Boon is one of the few cards in this wave the rulebook
rules by name (p. 49):

> **Consanguineous Boon.** "You must choose an **existing clan**, even if
> **no vampires of the chosen clan are in play**."

That settles what would otherwise have been the obvious implementation.
The terms are **not** "clans currently on the table" — they are the
fourteen clans the V5 crypt contains, whether or not anyone controls one,
and a referendum that passes on a clan nobody plays simply pays nobody.

So **`CLANS` in state.ts**, the `CITY_TITLES` precedent applied exactly:
a constant, **derived** rather than guessed, with a test that re-derives
it from `registry.json` so it cannot rot the way the "Assamite" clan
filter did. Fourteen: Banu Haqim, Brujah, Gangrel, Hecata, Lasombra,
Malkavian, Ministry, Nosferatu, Ravnos, Salubri, Toreador, Tremere,
Tzimisce, Ventrue.

**Reading on record: the payout counts VAMPIRES, not minions.** "For each
vampire of the chosen clan they control" — an ally has no clan at all in
this engine (`clan: null`), so the filter excludes them by construction
rather than by a rule.

## 2. Terms over two different KINDS of thing

`refAllocateBurn` and `refChooseSeatsBurn` both range over **seats**, and
`refExpelMinions` over **minions**. Three of these five range over
something else, or over two things at once:

- **`refBurnSeatOrLocation`** (Cold War) — "choose a Methuselah **or** a
  location", with an either/or that becomes an **and** when the caller
  holds a specific title. So the terms are: every seat, every location,
  and — only if `cardinal` or `regent` — every (seat, location) pair.
  **The title is read when the terms are chosen, not when the card is
  played**, which is where p. 27 puts term selection ("terms chosen only
  on success" is the politics kernel's own note) and is also the only
  moment the answer is stable.
- **`refMoveLocation`** (Disputed Territory) — "choose a location **and**
  a Methuselah": the cross product, and the payout is
  `changePermanentControl`, built for the control-change gate. **A
  Methuselah may be chosen who already controls it**, which is a legal
  no-op the card does not exclude.
- **`refAllocateBurn` gains `beneficiary`** (Camarilla's Iron Fist) — the
  existing allocation with one seat named separately. **Reading on
  record: "two or more OTHER Methuselahs" means other than the CHOSEN
  one**, not other than the caller: the sentence names the chosen
  Methuselah as the one who gains, so "other" is measured from them. A
  caller may therefore allocate points to themselves, which is legal and
  bad play.

**Every option carries its whole answer in the option id**, so a trace
test reads `terms:<seat>` / `terms:<location>` / `terms:<seat>|<loc>`
without a second decision. That is the politics kernel's existing rule
and the reason none of this needs a ChoiceFrame.

## 3. Anarch Salon — a payout with no terms at all

"Each ready Anarch gains 1 blood and each Methuselah controlling an
Anarch gains 1 pool." No choice, so no terms; `refBurnPerMinion` already
proves a primitive can have an empty `referendumTerms`.

**`refSectPayout`** carries both halves because the card does:
`{ sect, blood, poolPerController }`. **Reading on record: a Methuselah
with three Anarchs gains ONE pool, not three** — "each Methuselah
controlling an Anarch" counts Methuselahs, where "each ready Anarch"
counts vampires. The two halves of one sentence count different things,
which is exactly the kind of thing worth a test rather than a comment.

**"Ready" is the ready region** (p. 16) — a locked Anarch qualifies, a
torpid one does not. That is `isReady`, and it is the same distinction
the Heart of Nizchetus test pinned last wave.

## 4. What this wave does not do

The three remaining Political Actions are a coherent follow-up rather
than a cut:

- **Archon** (100084) and **Raising the Portcullis** (102303) both
  *become permanents on a passed referendum* (`refPutInPlay`, built for
  War of Ages) and are both voted back out with
  `vulnerableTo.via: "politicalAction"`. Archon additionally wants a
  **persistent block toll** — `ActionFrame.blockCosts` is action-scoped,
  and "vampires attempting to block the attached vampire burn 1 blood"
  is a property of the bearer — and **blood-hunt immunity**, which
  nothing models yet.
- **Revolutionary Council** (101631) is the biggest allocation in the
  pool: X chosen Anarchs, 2X points, spread over Methuselahs *and*
  locations *and* equipment. It wants `enumerateAllocations` over a
  heterogeneous target list, which is a real extension rather than a
  field.

All three are recorded in `partial-support.md` with those blockers.
