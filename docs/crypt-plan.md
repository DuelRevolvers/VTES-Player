# The crypt: what it takes to get 217 cards working

Written 2026-09-03 at the owner's request, before phase 5. **Survey
first, from the card data — no build has started.**

---

## 1. The headline: 118 of 217 already work

Splitting the crypt by whether the card has any rules text beyond its
sect/title line:

| | count |
|---|---|
| **Bare sect/title only — already playable today** | **118** |
| Has a real ability | 99 |

The 118 need nothing. The playtest decks are already built from them
deliberately, so nothing on the table silently does nothing
(`validateDecks().inertAbilities`).

So the crypt is a **99-card job**, not a 217-card one — about the size of
four of the library waves we just ran, and the cards are individually
*smaller* than library cards.

---

## 2. The architectural answer, and it is already proven twice

**A crypt card's ability becomes a self-attached entry on the minion —
exactly what an ally's card text does, and what a token vampire's does.**

`MinionState.attached` already holds an entry whose `card.id` equals the
minion's own id; `minionTags` and the whole `permanent` vocabulary read
it. Allies have worked this way since the allies gate, token vampires
since 2026-09-03.

**The consequence is the whole plan: the entire `permanent` vocabulary
applies to crypt cards unchanged** — `statics`, `conditional`, `aura`,
`rushGrant`, `bleedGrant`, `blockCosts`, `playCostMod`, `counterGrant`,
every hook (`onActionResolved`, `onBleedSuccess`, `onLeaveReady`,
`onControllerUnlock`, …). A crypt spec is a `CardSpec` with a `permanent`
block and no cost, no modes and no play path.

Reading all 99 abilities against that vocabulary:

| Shape | ≈ cards | Status |
|---|---|---|
| Flat statics (+1 bleed / strength / intercept / stealth) | 8 pure, plus a trailing "+1 bleed" on ~20 others | `PermanentStatics` — data |
| Conditional statics ("during directed actions", "against titled vampires", "while you have ≤5 pool") | ~19 | `ConditionalStatic` — data, plus a few new condition fields |
| Granted actions (rush, search, steal equipment, add blood) | ~12 | `rushGrant` / granted-action machinery — data |
| Unlock riders ("can unlock after a successful action") | ~8 | `onActionResolved` + `afterResolutionUnlocks` — data |
| Block tolls and block bars | ~7 | `blockCosts`, `blockedPoolToll`, `cannotBlockKind`, `blockerMatchesFilter` — **all built**, one of them (Aelswith) built *today* |
| Play-cost modifiers | ~6 | `PlayCostMod` with clan/tag/discipline filters — data |
| Combat grants (maneuver, press, granted strike, prevent-for-another) | ~14 | `maneuverPerCombat`, `pressPerCombat`, `grantedStrikes`, `preventDamageFor` — data |
| Bleed/turn payoffs, library and ash-heap moves | ~15 | library-search gate, ash heap, `handSizeOf` grants — mostly data |
| **Genuinely new small primitives** | **~10** | see §4 |

**Roughly 85 of the 99 are data against primitives that already exist.**
That is not a coincidence — it is the library waves paying out. The crypt
was always going to be cheap *if* the library was built first, and it
was.

Two cards prove the point exactly: **Aelswith, The Irresistible** prints
Terrifying Visage's sentence word for word (`blockedPoolToll`, built
2026-09-03), and **Flávio Gonçalves** prints Treasured Samadji's
("once each combat, can strike: dodge").

---

## 3. Structural green lights

Checked, not assumed:

- **Zero merged/advanced cards** in the V5 crypt. The entire merge
  mechanic — a second, upgraded printing of a vampire — is out of scope
  by the data, not by a decision.
- **Zero duplicate crypt names**, and **zero collisions with library card
  names**. The handler registry is keyed by name and needs no change.
- **The importer already reads everything a minion needs**:
  `src/ui/cardinfo.ts` gives name, capacity, clan, disciplines, sect,
  title, scan — and `path` as of today. Sect and title parse cleanly off
  the card-text prefix (67 cards print a title).
- **Groups are 5/6/7** and group legality is a *deck-construction* rule,
  not an in-game one. It belongs to deck import, not to the engine.

---

## 4. What is actually missing

**Structural (small, one pass):**

1. **A crypt spec kind.** `CardSpec` assumes a playable card: cost, modes,
   a play window. A crypt card is never played — it is *influenced out*.
   Cleanest: `cryptSpecs` alongside `cardSpecs`, compiled by a
   `compileCrypt` that emits only the `permanent` half and the hooks.
2. **`makeVampire` attaches the self entry.** One place, mirroring
   `AllyEnteredPlay`.
3. **`supported.test.ts` needs a crypt branch** — it cross-checks
   `bloodCost`/`poolCost` against the registry, and a crypt card has
   neither.
4. **The tally** — "Crypt 0/217" becomes a real number.

**New primitives (~10, all small, each with several users):**

- "discard a card requiring \<Discipline\> to get +N" — **6 cards**
  (Alexa Draper, Larissa Moreira, Abraham DuSable, Yewon Ong, Kasim
  Bayar, Phaibun). One primitive.
- Counting statics — "+1 bleed for each unique equipment attached to
  him" (Hesha Ruhadze).
- Reveal-the-top-card-and-branch (Gathii).
- A coin flip (Evan Klein) — `EngineOps.randomIndex` already exists.
- "+1 discard phase action" (Sreelekha) — `TurnFrame.discardActionsLeft`
  already exists.
- "Ranged strikes inflict +1 damage even at close range" (Noluthando).
- "Until your next discard phase" as a duration (Fotini Katsikaris) — the
  hand-size grants are frame-scoped, and this one is not.
- Conditions that read another seat's board — "while your predator
  controls more ready minions than you" (Khin Aye), "while your prey has
  ≤10 pool" (Üresség). The aura wave built one of these
  (`whilePreyHasTorporVampire`), so the pattern exists; it needs
  widening.

**One card needs an owner decision, not code:** **Cedrick Calhoun** goes
to torpor if his own referendum is cancelled or fails — fine — but
"cancelled" and "failed" are two different flags in this engine
(`docs/abstain-gate-design.md`), and the card treats them alike. Worth
one line of confirmation when we get there.

---

## 5. The one real rules gap, and it is already on the ledger

**Contested cards.** A crypt card is unique: if two Methuselahs control
the same vampire, the card is *contested* and both lose it until one
yields (p. 19, and the same for unique titles). The engine models
**own-duplicate prevention only** — this is a recorded, owner-visible
deviation and is currently marked out of scope.

It matters more in the crypt than the library, because a 12-card crypt
drawn from a 217-card pool makes collisions likely in a real 5-player
game. **This is the one thing in phase 7 that is a decision rather than
work**, and it is worth taking before the crypt build rather than after.

---

## 6. Suggested sequencing

The crypt naturally splits into four waves, cheapest first — the same
shape that worked for the library:

| Wave | Content | ≈ cards |
|---|---|---|
| **C1** | The spec kind + `makeVampire` + the tally, then every **flat and conditional static**. No new mechanics at all. | ~27 |
| **C2** | **Granted actions and unlock riders** — rushes, searches, "can unlock after…". All existing machinery. | ~20 |
| **C3** | **Combat and blocking** — tolls, bars, maneuvers, presses, granted strikes, prevention for another minion. | ~21 |
| **C4** | **Payoffs and the new primitives** — bleed/turn riders, ash-heap and library moves, the discard-for-bonus family, the ~10 new pieces. | ~31 |

C1 is the one with the structural work in it and is therefore the one
worth doing carefully; C2 and C3 should look like the library waves that
went four or five cards at a time.

**Deck import is a separate job** (the other half of phase 7): a KRCG
deck-list parser, group legality, the 12-card crypt, and the deck hash
noted in `docs/cockatrice-lessons.md`. It does not block the ability
work, and the ability work does not block it.

---

## 7. How this interacts with phase 5 (AI)

**It does not block it, and the order is a real choice:**

- **AI first** (the current plan) means the AI is developed against 118
  crypt cards that have no abilities — simpler, and the `Agent` interface
  does not care.
- **Crypt first** means the AI is developed against the real game.

The argument for AI first is that every crypt ability is *data behind the
same legal-move generator*, so an AI built against the option list keeps
working as abilities land. The argument for crypt first is that a game
where no vampire has an ability is not the game the AI will eventually
play, and batch simulation results would need re-taking.

**Recommendation: phase 5 first, as planned** — but do **C1** before it,
because C1 is where the structural work lives (~2–3 hours), it turns the
crypt tally off zero, and it means the AI is being tuned against vampires
that at least carry their printed traits.
