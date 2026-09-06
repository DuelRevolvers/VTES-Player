# Crypt wave 4 — trading a card for a bonus

2026-09-03. **Crypt 74/217 supported. 192 of 217 crypt cards play
correctly; 25 ability cards remain.**

15 cards. One primitive does seven of them, and the wave found a live
engine bug that had been dead code since the hook was written.

---

## 1. The discard-for-a-bonus family — one clause, seven cards

Seven crypt cards print the same sentence with three things swapped:

| Card | Which card pays | What it buys | Window |
|---|---|---|---|
| Alexa Draper | requires `[dom]` | +1 vote | polling step |
| Yewon Ong | requires `[obl]` | +1 vote | polling step |
| Larissa Moreira | requires `[ani]` | +1 bleed | a bleed action |
| Abraham DuSable | requires `[tha]` | +1 intercept **or** +1 stealth | any action |
| Kasim Bayar | a political action card | +2 strength that combat | before range |
| Phaibun | **a card at random** | strike: dodge | choosing a strike |
| Roger de Camden | requires `[obl]` | 1 maneuver **to another minion** | a combat involving one of yours |
| Marchesa Liliana | **7 cards from your ash heap** | +1 bleed | a bleed action |

`permanent.discardFor` keeps those three axes independent —
`requiresDiscipline` / `cardTypes` / `random` / `fromAshHeap` say what
pays, `grant` says what is bought, `when` says where the trade is
offered — and every one of the payoffs was an op that already existed.
**Marchesa is the proof that the split was worth making**: her clause is
a currency the family had never used, and she is one line of data.

Three details each earned their place:

- **The random discard is rolled at USE, never at enumeration.** An
  option list is a pure read, and rolling in it would consume the RNG
  every time the engine asked what was legal — which happens many times
  per decision. Phaibun therefore offers exactly **one** option with no
  card named; offering the player a choice of which card to lose would be
  a lie about what the card does.
- **`requiresDisciplines` needed a UNION across modes.** The central
  query answers for a *chosen mode* and falls back to the first when
  asked for none — right everywhere it had been used, and wrong here,
  because the card is being **discarded**, never played, so there is no
  chosen mode. A card whose superior alone requires the Discipline still
  qualifies.
- **Stealth and intercept are gated separately** (p. 26, only when
  needed), because Abraham can be at either end of the same block. The
  shared `stealthIsNeeded()` helper does one half and its mirror the
  other, so the two cannot drift on the rule that matters.

`addCombatStrengthTo(minion, amount)` is new — the combat-**long**
sibling of `addRoundStrengthTo`, since Kasim's bonus is "that combat".
`addCombatStrength` (which takes a `CardPlayFrame`) now delegates to it,
so there is one implementation, the shape `setHandStrikesAggravatedFor`
took in wave 3.

---

## 2. "And/or" is a UNION, and one modifier not two

Roger's first clause is *"cards requiring Hecata **and/or** Oblivion cost
Roger −1 blood"*. `PlayCostMod`'s default is that **every filter present
must match** — an intersection — so the obvious build is two modifiers,
one per filter.

**That is wrong, and cheaply so: a card requiring both would be charged
−2.** The card says −1. So `PlayCostMod.clanOrDiscipline` flips those two
filters to a union inside one modifier, which cannot double-count. One
flag, one branch in `playCostModApplies`, and a test that plays a card
matching both and asserts the discount is still 1.

This is the English-"and" reading recorded in
`docs/opposing-statics-design.md`, arriving from the cost side.

**Kuyén and Máddji needed nothing new at all.** "Animals (allies and
retainers) cost −1 blood or pool" is `tags: ["animal"]` with
`pays: "bloodOrPool"`, and "allies and retainers requiring a Tzimisce" is
`requiresClan` off the central query — both filters and the dual-resource
payment were built for the play-cost gate and the retainer wave.

---

## 3. Uniqueness had to become a TAG

Hesha Ruhadze gets "+1 bleed for each **unique** equipment attached to
him", and `currentBleed` reads entries in play — it has no registry, and
giving it one to answer a single card would be the wrong trade.

So uniqueness is denormalized into the tag vocabulary that already
answers *location / vehicle / ghoul / animal / equipment*, and
**centrally, in `backfillCentralQueries`**, for exactly the reason the
"equipment" tag beside it is central: a hand-rolled handler would
otherwise be silently missing from every count. `.44 Magnum` is the test
case in both directions — it must carry the type tag and not the
uniqueness one.

`PermanentStatics.bleedPerAttached` is the count, and it skips the
counting entry itself: **every crypt card rides in as a self-attached
entry**, so "count the bearer's attachments" would otherwise include the
vampire.

---

## 4. THE BUG: `onBleedSuccess` had never reached an attached card

Gostoso ("after he successfully bleeds your prey, he can gain 1 blood")
did nothing, and the reason was not in his code.

```ts
for (const s of this.state.seats) {
  for (const p of [...s.permanents]) {          // seat-level cards ONLY
    this.registry[p.card.name]?.onBleedSuccess?.(...)
```

The hook's only user was **Alamut, a location**, so the omission was
invisible — and wrong the moment a card sat on a vampire. **That is the
`onAnyUnlock`/Fame bug verbatim** (`docs/pool-drain-design.md`), one hook
along, and it will keep happening while hooks are hand-written loops
rather than `allEntries()`. Fixed to `allEntries()`, which also gives the
hook the bearer's id — the thing Gostoso needs to know it was *him* who
bled.

Worth stating as a rule: **a hook that iterates `seat.permanents` is a
hook that does not exist for attached cards.** Every crypt ability is
attached, so wave 5 should audit the rest rather than wait to be bitten.

---

## 5. The small hooks

- **Sreelekha** — "+1 discard phase action". p. 37's default is set as
  the phase opens and `onDiscardPhase` fires immediately after, so
  `addDiscardPhaseActions` simply adds to it. Gated on the **turn seat**,
  which is the 2026-08-02 bug's lesson: that window is offered to every
  Methuselah, so "during YOUR discard phase" must say so.
- **Věnceslava** — "after resolution of an action **during which** your
  prey burned 1 or more pool". "During which" is a read of the event log
  from that action's `ActionAnnounced` forward. **The record already
  exists**, so there is nothing to bookkeep — the Week of Nightmares
  lesson in a new place.
- **Abderrahim** — "burn 1 blood to give an ally **or** younger vampire
  you control +1 stealth". The union reading again, and `modifyStealth`
  is **action-scoped**, so a stealth bonus granted by a third party is
  the same primitive as one the actor plays; only who may grant it moved
  (`docs/other-vampire-modifiers-design.md`).

---

## 6. Readings on record

- **A "ready" vampire may be LOCKED** (p. 16) — Sreelekha and Roger both
  say "ready", and torpor is what takes a vampire out of the ready
  region. Pinned, because a fixture asserting the opposite is how this
  was got wrong once before (`docs/cheap-tail-design.md`).
- **The discarded card IS replaced** (p. 7: "whenever an effect … adds or
  removes cards from your hand"). A cost is still a removal; the
  unlock-tolls wave found two sites that had this backwards.
- **Marchesa's seven cards are REMOVED FROM THE GAME, not discarded.**
  p. 16 gives such a card no zone at all, so `CardLeftZone` with nowhere
  to go *is* the removal, and nothing can retrieve them.
- **Gostoso's blood is taken automatically** — costless, purely
  beneficial and unpunished by anything on the card (the Cursed Abattoir
  reading), and `BloodGained` clamps at capacity, so it can never hurt.

---

## 7. Deferred, with reasons

- **Ashur-uballit** (201741) — "zombies you recruit or employ get +1
  starting life". The filter and the tag both exist; what does not is a
  hook at the ally/retainer **entry** path where `life` is computed, and
  that path is shared by every ally in the game. Worth doing deliberately
  with the other cards that modify an entering minion.
- **Jason Newberry** (201628) — "+2 votes when casting votes **against**
  blood hunt referendums". `ReferendumFrame`'s bloodHunt variant exists
  and `ConditionalStatic.votes` exists; the missing axis is the **vote
  direction**, which is chosen at cast time, so the vote enumeration
  would have to offer different amounts for `for` and `against`.
- **Alexander Silverson** (201530) — "vampires must burn 1 blood to cast
  votes and ballots against referendums called by Alexander": a toll on
  *casting*, which is the block-tax gate's shape one frame over.
- **Cedrick Calhoun** (201626) — torpor if his own referendum is
  cancelled **or** fails, after resolution. `cancelled` and `forcedFail`
  are deliberately two flags (`docs/abstain-gate-design.md`); this is the
  first card that wants both, plus a hook after a *cancelled* referendum,
  which by construction emits no `ReferendumResolved`.
- **Evan Klein** (201627) — a coin flip as an action is announced.
  `randomIndex` exists; the window (as an action is *announced*, before
  the announce cycle) does not.
- The ash-heap and library movers (**Lenelle, Mora, Hel-Blá, Eulogio**)
  and the granted actions (**Seraphina, Saankaláxt, Aniel**) are wave 5:
  each is a granted action with a cost, and `announceEntryAction` already
  takes every piece — they were left out for size, not difficulty.
