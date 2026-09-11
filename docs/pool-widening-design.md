# Widening the card pool beyond V5 — the phased plan

**Status 2026-09-08 (`platform v0.8.0`): the MACHINERY is built and
green; the POOL is back to V5-only, deliberately.**

- §0 **NO PARTIAL CARDS** is binding, and is now enforced by the build
  rather than by discipline.
- Phases 0, 1 and 2 built the pipeline — the config split, the group
  rule, the sect/title fixes, the ambiguity-resolving importer.
- **Phases 1 and 2 were then rolled back** (§7). They had admitted 1,104
  vampires with inert abilities, which §0 forbids. `crypt-groups.json` is
  `"groups": []` and the registry is byte-identical to a V5-only build.
- §4 decided (a) print-faithful; §5 decided (c) context-then-report; §7
  decided (a) roll back and re-widen behind the card waves. All on the
  owner's word.

Pool now: **crypt 217, library 444, total 661 — every one of them
whole**, which `tests/cards/no-partial-cards.test.ts` asserts over the
entire registry.

Written 2026-09-08 against `platform v0.7.4`. Every number is measured
from `data/vtes-raw.json` (4,149 KRCG cards, already local — no network
fetch) and `src/cards/registry.json`, not estimated.

Supersedes the one-line note in CLAUDE.md's queue ("PHASE 8 — widen the
pool beyond V5. The months-long one").

---

## §0 NO PARTIAL CARDS (BINDING — owner rule, 2026-09-08)

> *"We can't half-ass any card, ever. We need all cards added to this
> platform working at 100% entirely or we literally can't play the game
> correctly. Never skimp on building cards."*

A card is **in the pool** only when it does everything it prints. Not
most of it, not the common case, not "the ability is rare so it can
wait." A vampire whose printed ability does nothing is a card that plays
wrong every time that ability would have mattered, and the player has no
way to see it happen.

This governs every phase below and outranks any counting argument in
them. Where a phase in this document says a card is "cheap" or "free", it
means cheap **to admit**, and §7 exists because that distinction was
elided once already.

Concretely:

- A card with a known-missing clause does not get flipped in
  `config/supported.json`. That rule already existed (CLAUDE.md, "Card
  registry rules"); this states the reason.
- "Reported as inert" is **not** a substitute for implemented. Telling
  the player a card does nothing is honest, and an honest wrong card is
  still a wrong card.
- Admitting a card to the registry is a promise about it. If the ability
  is not built, the card does not come in yet.

---

## §1 The finding the whole plan rests on

**Crypt and library are gated in completely opposite ways.** From
`validateDecks` (`src/ui/decks.ts`):

- **A library card that is not implemented makes the whole deck
  unplayable.** Hard gate, per card.
- **A crypt card is never gated on support at all.** Any crypt id in the
  registry plays. An unimplemented ability is reported as `inertAbilities`
  — *"the vampire is a real card with real stats and the game plays fine
  without its text"* — and is explicitly not fatal.

That is why the pool already reads "99/217 have implementations, and ALL
217 play correctly".

So widening the crypt is nearly free, and widening the library costs one
card wave per card. **Every phase below is ordered by that fact.**

### What the crypt actually carries

Verified for the 347 candidates in §3, and for the existing 217 by
`tests/ui/crypt-sect-title.test.ts`:

| Field | Source | Risk |
| --- | --- | --- |
| Capacity | KRCG `capacity` | none — 0 missing |
| Clan | KRCG `clans` | none — 0 missing, and KRCG already uses **V5 clan names** ("Ministry", not "Follower of Set"), so V5 clan filters match legacy vampires |
| Disciplines | KRCG `disciplines`, level by letter case | none structurally — but see §4 |
| **Sect** | **parsed from card text** | the one that can rot |
| **Title** | **parsed from card text** | the one that can rot — titles are votes |

Sect and title are the only two facts not read straight from the data.
Both are verified clean for the current 217, in both directions (nothing
missed, nothing invented).

---

## §2 Phase 0 — the groundwork (do this whatever else is agreed)

Small, and every later phase needs it.

1. **Split the pool filter.** `config/v5-sets.json` admits *whole sets*,
   and `scripts/build-registry.mts:171` is one line:
   `cards.filter((c) => intersectSets(c, poolSets).length > 0)`. Widening
   by set drags in that set's library cards, which are hard-gated — so a
   set-level widening breaks decks. Add a second config
   (`config/crypt-sets.json`) and admit a card if it is in the V5 sets
   **or** it is a vampire in the crypt sets.
2. **Keep precons scoped to the V5 sets.** `collectPrecons(inPool,
   poolSets)` derives from the same snapshot; unscoped, it will emit
   half-built decks into the picker.
3. **Exclude Imbued explicitly.** `isCryptRaw`
   (`scripts/krcg-common.mts:63`) returns true for `"Imbued"`, and there
   are 20 outside the pool. They are not vampires — life instead of
   blood, conviction, powers — and the engine has no model for them. See
   §8.
4. **De-hardcode the count assertions.** 661 / 444 / 217 appear in tests
   and in CLAUDE.md. Pin the *reason*, not the count (CLAUDE.md: "an
   assertion about a total set is a hostage to every future change").
5. **Two small decisions, cheap now and expensive later:**
   - **Laibon.** 6 candidates print `Laibon`. The importer's regex matches
     the word but `Sect` is `camarilla | anarch | sabbat | independent`
     (`src/engine/state.ts:129`), so they land sectless. The V5 rulebook
     does not mention Laibon at all — I searched it. Owner call: map to
     Independent, or exclude.
   - **Inner Circle.** The engine values `innerCircle` at 4 votes
     (`TITLE_VOTES`), but the importer's title table has no entry for it,
     and its parse matches single words only — "Inner Circle" is two. No
     V5 crypt card prints it, so nothing is broken today. But a card in
     the pool reads *"Requires a prince, justicar or Inner Circle
     member"*, so the first legacy Inner Circle vampire admitted would
     parse titleless and silently lose 4 votes.

**Deliverable:** the registry can admit crypt from outside the V5 sets,
and nothing else changes. Fully reversible — revert the config.

---

## §3 Phase 1 — crypt, groups 5–7 (the easiest real win)

**347 vampires, no engine work.**

Every crypt card is printed with a **group number** (1–7): a
compatibility band. A deck's crypt may only mix **adjacent** groups (5+6,
6+7 — never 5+7). The current pool is group 5:2, 6:188, 7:27, so groups
5–7 are the vampires that can legally sit alongside what is already
there.

| | count |
| --- | --- |
| Bare text **and** every discipline already used by the pool — completely correct, completely usable | **34** |
| Every discipline usable (some have ability text that will be inert) | **150** |
| Structurally correct and playable; part of the discipline line inert | **347** |
| …of which Laibon, pending §2.5 | 6 |

Mostly from Keepers of Tradition (82), Heirs to the Blood (56), Lords of
the Night (40), The Unaligned (33).

**Be honest about what this buys.** These are *more bodies with correct
stats, sects and titles* — useful for politics immediately, since votes
come from titles. It is **not** 347 new strategies: 197 of them carry at
least one legacy discipline that no card in the pool requires (§4), so
half their discipline line does nothing until §6.

**Tests:** `tests/ui/crypt-sect-title.test.ts` already walks whatever the
registry holds, so all 558 are covered by it — sect and title verified in
both directions. `tests/cards/pool-widening.test.ts` pins the pipeline's
negative space (no library admitted, no Imbued, no unconfigured group, no
Laibon, precons still V5-only) with a control that the widened set is
non-empty, so those five cannot pass by matching nothing.

### What Phase 1 actually cost, in hindsight

Three things the plan did not predict, all caught by the existing suite:

1. **`CLANS` had to grow, 14 → 35.** It is what Consanguineous Boon
   offers, and p. 49 says "an EXISTING clan … even if no vampires of the
   chosen clan are in play" — every clan *in the pool*. The bloodlines and
   the antitribu arrived with the widening, so a card offering 14 of 35
   would have been wrong by its own citation. Hand-listed still (the
   kernel stays free of the card data); `clan-vocabulary.test.ts` now
   asserts `CLANS` equals the registry's set exactly.
2. **Two count-hostage tests fell**, exactly as §2.4 predicted — the clan
   count (14) and the city-contest list (Mannheim/Pittsburgh). Both
   rewritten to pin the reason.
3. **The bundle grew ~163 KB** (1,108 → 1,271 KB raw, 244 → 271 KB
   gzipped) from 341 extra registry entries. Worth knowing against
   phase 9's first-paint work, though it is dwarfed by the banner.

One rules correction worth recording: a first draft of the contest test
asserted that a shared city must be claimed by *different* titles. That is
wrong — the widened pool has two Princes of Chicago, and p. 39 says a city
title is contested by any vampire claiming **any** title to the same city,
so the same title is the primary case, not an anomaly.

---

## §4 The legacy-discipline problem (a decision, not a phase)

The pool knows 11 disciplines: `ani aus cel dom for obf obl pot pre pro
tha`.

The 347 candidates bring 18 more — `nec`(39) `dem`(28) `chi`(24)
`vic`(23) `obt`(23) `qui`(22) `ser`(19) `san`(10) `vis`(10) `thn`(10)
`val`(9) `dai`(7) `obe`(6) `myt`(5) `tem`(4) `spi`(4) `mel`(4) `abo`(3)
— the Necromancy / Dementation / Chimerstry / Vicissitude / Obtenebration
/ Quietus / Serpentis family.

Nothing breaks: they are stored correctly, the UI prints discipline codes
generically, and `disciplineOk` simply never matches them. **They are
inert, not wrong.**

**The decision:** V5 folded several of these into new disciplines
(Necromancy and Obtenebration into Oblivion, much of Serpentis into
Protean). Two readings:

- **(a) Print-faithful.** A legacy card says Serpentis, so it *is*
  Serpentis — a distinct discipline. Legacy cards work with legacy cards;
  V5 cards do not see them. This is what the code does today, by
  accident, and it is almost certainly correct — the Golden Rule (p. 16)
  says card text wins.
- **(b) Translate.** Map `ser` → `pro` etc. so legacy vampires can use V5
  cards. Simpler decks, but it rewrites printed card text, and every
  mapping is a judgement call.

**Recommendation: (a).** It needs no code and no rulings. It does mean
legacy vampires are politically and statistically useful long before they
are mechanically interesting, which is the honest trade.

---

## §5 Phase 2 — crypt, groups 1–4 — **DONE**

**Status 2026-09-08: complete.** Attempted, rolled back on a blocker,
resolved by owner decision (c), and landed. **Crypt 1,680, library 444,
total 2,124** — every group, 61 advanced printings, 36 clans.

### The blocker, and how it was resolved

Crypt names stop being unique across all seven groups: **73 bare names
cover 148 cards**, in two shapes — base vs advanced at the same group
(`Alan Sovereign (G3)` / `(G3 ADV)`) and the same vampire in different
groups (`Annabelle Triabell (G3)` / `(G6)`). Deck lists match by name, so
V5 precons round-tripped as *illegal*: a bare name resolved to a group-2
vampire inside a group-6 deck.

**Owner decision: option (c) — context first, ambiguity reported when
context does not settle it.** Built as:

- `findCards()` returns EVERY printing a written name could mean, rather
  than silently preferring one. An exact spelling is unambiguous by
  construction because the group is part of it.
- **A bare name always means the BASE printing.** Base and advanced share
  a group, so no context could separate them, and every deck list marks
  the advanced one explicitly (p. 6). Treating a bare name as ambiguous
  would reject lists that are perfectly clear.
- `importDeck` runs **two passes**: pass one resolves every unambiguous
  line and records the deck's groups; pass two settles the rest against
  them via `narrowByGroup`. What the group rule guarantees is what makes
  this safe rather than a guess — a crypt spans at most two consecutive
  groups, so a candidate that cannot sit beside the groups already seen
  cannot be the one meant.
- Anything still unsettled is **reported with its candidates**
  ("several cards are called that — write the group, e.g. …"), never
  guessed. A deck importer that guesses builds a deck the player did not.

### What landed and stays

- **The group rule itself**, `cryptGroupProblem()` in `src/ui/decks.ts`,
  wired into `validateDecks`'s `illegalDecks` with seven tests. p. 4/6:
  *"a single group or from two consecutive groups. This does not restrict
  a Methuselah from stealing vampires from other groups through play."*
  That second sentence is why it is a deck-construction check and never an
  engine one. `ANY` (Anarch Convert, New Blood) is a wildcard, dropped
  before the span is measured.
- **A real bug in the sect/title parser.** An advanced vampire's text
  opens `"Advanced, Sabbat bishop"`, and the sect clause is anchored to
  the start — so the prefix hid the sect *and the title* on every advanced
  card. Invisible while the pool was V5-only, which has none; groups 1–4
  brought 22, four of them titled, and **a lost title is lost votes**.
  Fixed in `importCryptCard` by stripping the marker before the clause is
  read (p. 6: "an advanced card is a type of vampire card", so the marker
  is not part of the clause).

### What blocked it: crypt names are no longer unique

**73 bare names are ambiguous, covering 148 of the 1,684 cards.** Deck
lists are matched by name, and with one group range a bare name was
unique. Across all seven it is not, and the ambiguity has two shapes:

- **Base vs advanced, same group** — `Alan Sovereign (G3)` /
  `Alan Sovereign (G3 ADV)`. The larger share.
- **Same name, different groups** — `Annabelle Triabell (G3)` /
  `(G6)`.

The symptom is not subtle: three deck-import tests failed, including
V5 precons round-tripping as **illegal** because a bare name resolved to a
group-2 vampire in a group-6 deck.

### Two more findings, both from the same root

The `Advanced,` marker sits BEFORE the sect clause, and **two separate
places read that clause by its first word**:

1. `importCryptCard` — fixed above, and worth 22 sects and 4 titles.
2. `widenedCrypt` in the registry builder — the Laibon exclusion read the
   first word too, so **four advanced Laibon walked straight through it**.
   Caught by the sect test, not by inspection. Fixed the same way.

That is the "one question asked in two places" lesson arriving on
schedule, and it was nearly a third: a second copy of the group rule was
written beside `validateDecks`'s other p. 14 checks before it was noticed
that `deckimport.ts` already had one. There is now exactly one
`cryptGroupProblem`, in `decks.ts`, and the importer calls it.

### The cost, measured

- **Bundle 1,271 → 1,760 KB raw** (271 → 346 KB gzipped). The registry is
  now 2,124 entries. Against phase 9's first-paint work this is no longer
  negligible — it is a quarter of what the banner costs.
- `simulate` unchanged at ~17 games/sec.

**1,199 more vampires** (group 1:119, 2:403, 3:261, 4:416).

Same zero engine cost per card, but it needs one real rule first:
**crypt-group legality is not modelled anywhere** — `decks.ts` never
looks at `group`. Today that does not matter, because the whole pool is
5–7. Admit groups 1–4 and players will silently build illegal crypts.

So Phase 2 = the group-adjacency rule in `validateDecks` (a deck problem,
reported like any other), then the cards. Do it *after* Phase 1 has been
played for a while, so the rule lands with something to test it on.

---

## §6 Phases 3–5 — the library, in three tranches

**1,920 cards.** By type: Action 404, Master 395, Combat 336, Action
Modifier 202, Reaction 158, Political Action 154, Equipment 143, Ally 99,
Event 40, Retainer 40.

**There is no free lunch here.** Only **3** of the 1,920 share printed
text with an already-implemented card, so "same card, different name"
is not a shortcut worth building tooling for.

The tranches, cheapest first:

| Phase | Tranche | Count | Why this order |
| --- | --- | --- | --- |
| **3** | Requires **no discipline** | **1,130** | No discipline prerequisite, so each is reachable by any vampire; many are Masters and Equipment, the shapes the CardSpec vocabulary covers best |
| **4** | Requires only **pool disciplines** | **275** | Playable by the existing crypt the day they land |
| **5** | Requires a **legacy discipline** | **515** | Gated on §4 and on Phase 1/2 — pointless before there are vampires who have those disciplines |

Each card follows the existing workflow unchanged (CLAUDE.md, "Adding a
card"): read the text from the registry, express as a `CardSpec` or a
hand-rolled `CardHandler`, deterministic scenario test asserting the
negative space, flip `config/supported.json`, rebuild, add to the fuzz
decks.

**Sequence within a tranche by mechanic, not alphabetically.** The waves
that went fastest in phases 1–7 were the ones that shared a primitive.
Expect the vocabulary to grow; extend it when a pattern recurs, per
principle 6.

**This is where the months are.** At the ~15–25 cards per wave this
project has sustained, tranche 3 alone is dozens of waves. It is also
the only part that is genuinely optional: Phases 0–2 stand on their own.

### How a legacy library card reaches the pool — STARTED 2026-09-09

**There is no config file for the library, and that is the design.**
The crypt needs `config/crypt-groups.json` *and* a wholeness gate,
because a vampire can be legitimately whole with no implementation at
all — it prints no ability. A library card has no such case: its text
*is* the card, so "implemented" and "may be in the pool" are the same
question. `widenedLibrary` in `scripts/build-registry.mts` therefore
reads `config/supported.json` and nothing else.

That makes §0 structural rather than enforced. There is no lever that
would let the library get ahead of the card waves, because the only way
to admit a card is to implement it. Adding one is the ordinary workflow
(CLAUDE.md, "Adding a card") — flipping the id in `supported.json` both
implements it and admits it, in one edit.

### Wave 1 — the legacy weapons (14 cards), 2026-09-09

Library **444 → 458**. Chosen because their entire printed text is a
strike, which is the shape `spec.weapon` already covers:

Desert Eagle, Bang Nakh — Tiger's Claws, Bastard Sword, Meat Cleaver,
Sengir Dagger, Blow Torch, Saturday-Night Special, Submachine Gun,
Chainsaw, Gas-Powered Chainsaw, Sawed-Off Shotgun, Brass Knuckles,
Combat Shotgun, Mark V.

**One thing the vocabulary could not say**, and six of the fourteen
print it: `weapon.usableOnce: "combat" | "round"`. Both latches already
existed on the combat frame (`usedThisCombat`, `usedThisRound`, the
latter emptied by the engine at the start of every round); the gate is
on OPTIONS, and the strike is spent when it is CHOSEN, not when it
resolves — a dodged strike was still a use.

**Keyed on the CARD INSTANCE, not the bearer.** The ruling is explicit:
*"a second copy allows a second use in the same combat"*
[ANK 20230316]. Keying it to the bearer would silently take a strike
away from anyone holding two Chainsaws. Note this is the opposite of
`spec.combatLimit`, which is per combat FRAME — a recorded deviation in
CLAUDE.md, and the two must not be confused.

### Wave 2 — the legacy locations (13 cards), 2026-09-09

Library **458 → 471**. Ten hunting grounds plus three lock-grant
locations:

**The ten hunting grounds** (Amusement Park, Base, Campground, Corporate,
Fetish Club, Institution, Morgue, Port, Shanty Town, University) print the
same clause as the twelve already in the pool and take the same
`huntingGround` helper — zero new code. **The clan icon is decorative**:
every hunting ground carries one (the V5 Society is Toreador, Zoo is
Gangrel) and none restricts who plays it or who gains the blood, so
Amusement Park being a Brujah antitribu card costs nothing.

**London Evening Star, Tabloid Newspaper** is WMRH Talk Radio without the
pool penalty; **Monastery of Shadows** is a seat `handSize` static plus a
capacity-filtered stealth grant. Both were already sayable.

**The Mausoleum, Venice** needed one knob: `lockGrant.extraUnlessInPlay`,
for *"with an additional +1 vote if the card named /Ventrue Headquarters/
is not in play"*. "In play" is ANY Methuselah's, and the amount is now
asked twice — the option's label and the grant — so both read one
`voteAmount` helper. A label saying "+2" over a grant of 1 is exactly the
drift CLAUDE.md warns about.

#### What this wave found: a library card's clan is not a clan

`clan-vocabulary.test.ts` broke, and it was right to. It derived the
clan vocabulary from **both** card kinds, which was harmless while the
library was V5-only — every library clan was also a crypt clan. The
legacy library brought in Giovanni, Osebo, Brujah antitribu and eighteen
more, and `CLANS` is what Consanguineous Boon offers, which p. 49 says
must be the clans **in the pool**.

A library card's clan is an ICON or a requirement, not a vampire. The
test now derives the vocabulary from the **crypt alone**, and a new
control asserts the library's icon-only clans really exist in the
registry and really stayed out of `CLANS` — otherwise the split is a set
that happens to be empty rather than a decision.

The same correction tightened the filter check: a clan literal in the
card sources is compared against `MinionState.clan`, so it must be a
**crypt** clan. Naming a library icon compiles, reads fine and matches
nobody — the "Assamite" bug, one widening later.

**This is the tax the library widening charges**, and it will recur:
every set derived from "the registry" has to be re-asked as "which card
kind, and why".

### Wave 3 — the legacy equipment statics (7 cards), 2026-09-09

Library **471 → 478**. Equipment whose whole printed text is a standing
property of the bearer — nothing to use, nothing to decide:

Aaron's Feeding Razor, IR Goggles, Hawg, Laptop Computer, Sacré-Cœur
Cathedral, The Signet of King Saul, Cloak of the Abalone.

Four needed nothing new (`maneuverPerCombat`, `pressPerCombat`, `bleed` +
`exclusiveKey`, `cannotBeBlockedBy.kinds` + the Living Manse
`notEquipment` opt-out). Three needed exactly one knob each:

- **`statics.hunt`** — "+1 hunt" on the BEARER. There was already a
  `hunt` on `PermanentAura`, and using it would have been the bug: an
  aura with no clan/sect/scope filter radiates onto *every* minion at the
  table, and `auraBonus` scans attached cards too. `huntAmountFor` now
  folds both, and the negative-space test asserts the other seats' minions
  are unchanged.
- **`cannotBeBlockedBy.minCapacity`** — the mirror of Rexton's
  `maxCapacity`, read through `capacityOf`.
- **`cannotBeBlockedBy.clans`** — a clan bar. **An ally has no clan**
  (`MinionState.clan` is nullable), and a null reaching `includes` is a
  silent false rather than a crash, so the null check is deliberate and
  pinned.

#### Two standing guards fired, and both were right

- **The equipment-tag guard** pinned Living Manse as the only card in the
  pool printing "does not count as equipment while in play". Sacré-Cœur
  prints the same clause, so the list is now two — and sorted, so spec
  order cannot break it.
- **The rules-panel guard** (`render.test.ts`) demanded that every printed
  sub-type in the pool be findable in How to Play. "Electronic" was new.
  This guard was written *for* the widening and it worked exactly as
  designed: the panel cannot quietly fall behind the cards.

Also: **the coverage guard** ("every supported card is named by some test
or fuzz deck") caught all seven before their tests existed. Between it,
the tag guard and the rules guard, the standing checks are now doing more
to keep a wave honest than the wave's own tests are.

### Wave 4 — legacy retainers and allies (7 cards), 2026-09-09

Library **478 → 485**. A life total and one static apiece, and **no new
vocabulary at all**: J. S. Simmons Esq., Tasha Morgan, Jackie Therman,
Childling Muse (retainers); Loyal Street Gang, The Knights, Gypsies
(allies).

#### The wave's real finding: `meetsRequirements`, fourth instance

Childling Muse requires a Malkavian, and the test that said so failed —
it was offered to a Brujah. `permanentActionOptions`, the **shared**
recruit-ally / employ-retainer / put-permanent-in-play enumerator, never
called `meetsRequirements`.

**This was not a new bug.** Four V5 cards were already affected:
Crypt's Sons (requires an anarch), Feral Hound (Ravnos), Szlachta
Assistant and Szlachta Bodyguard (Tzimisce) — every one of them could be
played by any minion at all. It is the fourth instance of this exact
shape, after the modifier/reaction loop, `requiresControlledTitle` and
the equipment compiler, and it is the second time the fix was applied to
one enumerator while a sibling went without. `legacy-minions.test.ts`
pins the V5 case as a regression, not just the new card.

#### …and the two bugs the fix then dealt in

Fixing the enumerator changes the option space, so every seeded fuzz game
reshuffles. Two failures appeared, and both were latent
(CLAUDE.md: *"a green fuzz before and a failure after usually means a
pre-existing latent bug just got dealt in"*):

- **An engine bug.** Crypt's Sons' `enterPlayBurn` picks a target at
  ANNOUNCEMENT and burns it at RESOLUTION. If the target is gone by
  then — burned in the combat the action provoked — `findMinion` returns
  null, the code fell through to `burnPermanent`, and that THROWS. A
  derived read must be total; it now checks `controllerOfEntry` first.
- **A test bug.** The fuzz's blood-conservation fold learns a vampire's
  capacity from the setup snapshot or a `VampireEnteredPlay` event. A
  TOKEN vampire (Waters of Duat, the Path cards) has neither — it emits
  `VampireTokenEnteredPlay` — so `cap` stayed `Infinity` and the fold
  added blood the engine had correctly clamped. The invariant was
  reporting a conservation failure against an engine that was right.

The fuzz's error wrapper now carries the STACK as well as the message: a
bare "no permanent in play: B-card-72" says nothing about which of ~460
cards asked for it.

### Wave 5 — the Praxis Seizures (13 cards), 2026-09-09

Library **485 → 498**. The hunting-ground treatment applied to politics:
thirteen political actions that differ only in the city name, built by
one `praxisSeizure(id, city)` helper. Amsterdam, Atlanta, Boston,
Chicago, Cleveland, Dallas, Dublin, Frankfurt, Houston, London, Miami,
Seattle, York.

**One new knob**, and the codebase had been waiting for it:
`refPutInPlay` gained `onActor` and `grantsTitle`.
`ReferendumFrame.cardInstanceId` has carried the comment *"kept so a
title-granting referendum can attach it on a pass"* since it was
written, and this is the first card to use it. The title is granted the
same way `permanent.grantsTitle` does it for a master — a `title` tag
plus a `TitleGranted` event — so one convention covers both and a card
filtering on titled minions cannot see one kind and miss the other.

#### The contested title — an assertion that was wrong, and the engine gap under it

The first cut of this wave left `unique` OFF, reasoning that *"this could
lead to a contested title"* merely DESCRIBES the rules and that
uniqueness here is the city rather than the card. Both halves of that
were wrong in a way worth recording.

**The engine's contest detector gates on `registry[name].isUnique`.**
Describing a contest is not the same as being reachable: without
`unique: true` the printed clause could never fire, and two Princes of
Chicago would simply coexist. The specs now set it — uniqueness *is* the
city, the card names one, and a second copy in play is the contest.

**Turning it on then exposed a real engine gap, pre-dating this wave.**
`burnPermanent` has always emitted `TitleLost` when a card tagged `title`
is burned. The CONTESTED path did not: `ContestBegan` pulls the card out
of the bearer's `attached` — "turned face down and out of play" (p. 17) —
and the bearer went on being a prince, granted by a card that was no
longer there. **Regent (V5) has the same shape**, so this was a live bug
in the existing pool, not something the widening introduced.

Fixed on both sides, because a contest can be won turns later:
`ContestBegan` now carries the `title` it took, `ContestedCard` holds it,
and `ContestWon` grants it back when the card returns to its bearer.
`tests/engine/contested.test.ts` pins all three, with a non-title card in
the same contest as the control.

**What is still not built, and matches nothing:** the LSJ ruling that a
weapon's optional maneuver cannot be used when its strike cannot
(Saturday-Night Special, Submachine Gun, and the V5 Assault Rifle and
AK-47). Its example card, Hidden Lurker, is outside the pool, and the
pool's own `handStrikesOnly` card — Immortal Grapple — is
`onlyAtCloseRange`, so it is played *after* the range step and the flag
clears at the start of each round. There is no ordering in this pool that
reaches the case.

**Fourteen of the twenty-seven stayed out.** Athens raises a Tremere
prince's capacity, and the rest each print a rider. §0: a card comes in
when all of it is built, so those wait for a wave that builds the rider.
The test asserts the pool holds exactly thirteen, so a later wave cannot
quietly admit a partial one.

They are not in the fuzz decks, and that is on purpose: the fuzz's
vampires are Sabbat and anarch, so a Camarilla-gated card would be dealt
and never playable — presence without exercise.

### Wave 6 — legacy referendums (4 cards), 2026-09-09

Library **498 → 502**. Autarkis Persecution, Perpetual Care, Exclusion
Principle, Rabble Razing — four political actions that differ only in a
filter and a resource, so they share **one** new primitive rather than
four bespoke ones:

```
refPerMinion { effect: "gainPool" | "burnPool" | "burnBlood", amount, who? }
```

`burnBlood` charges each MINION; the other two charge the seat, so the
effect decides who pays as well as what.

**One primitive, four filters is the risk**, and it is the "empty for the
wrong reason" shape: a filter that is too broad pays for minions the card
never named, one that is too narrow pays for none, and neither throws. So
each card has a case its filter EXCLUDES as well as one it includes —
allies counted by Autarkis (which says *minion*) and not by Rabble Razing
(which says *vampire*), capacity 4 spared where 3 burns, a torpid
Independent not paid by Exclusion Principle. A whole-table fail-path test
is the baseline every one of those is measured against.

**Two fixtures failed for the reasons CLAUDE.md warns about**, not the
cards: a torpid vampire cannot call the referendum it is meant to be
excluded from, and a vampire set to 0 blood has a MANDATORY hunt (p. 21)
and so cannot act either. Both moved off the caller.

#### Closed out from wave 3

Hawg's one-vehicle limit and Laptop Computer's one-per-minion limit were
asserted as TAGS. Both are now behaviour: the option really disappears
for a minion already carrying one, and Laptop Computer is still offered
to a different minion — the half that separates `exclusiveKey` from
`unique`.

### Wave 7 — legacy one-shot masters (6 cards), 2026-09-09

Library **502 → 508**. Ascendance, Vulnerability, Unnatural Disaster,
Effective Management, Tribute to the Master, Letter from Vienna.

The master compiler already had a one-shot path with its own effect
switch beside the permanent/attach path, so each card is one small case
in it: `gainPool`, `burnTorpidVampire`, `burnLocation`,
`cryptToUncontrolled`, `eachOwnReadyVampireBloodToPool`,
`lockAllMatching`. **This opens the largest remaining bucket** — 380-odd
legacy masters — at roughly one switch case per card shape.

#### Two rulings that answer the same question in opposite directions

May a card be played when it would do nothing? Both of these say so
explicitly, and neither answer is derivable from the card text:

- **Effective Management** — *"cannot be played when the target crypt is
  empty"* [RTR 20000501]. Gated in the OPTIONS enumerator, so an empty
  crypt makes it unplayable rather than a wasted master phase.
- **Tribute to the Master** — *"can be played with no ready vampire"*
  [ANK 20210717]. Deliberately NOT gated.

Guessing either would have looked right. Both directions are asserted.

#### Two things read the way this codebase has been bitten before

- **`burnLocation` keys on the printed `location` TAG, not the card
  type.** Living Manse and Sacré-Cœur are equipment cards that print
  "represents a location", and they are locations for every card that
  names one.
- **It searches attached cards as well as `seat.permanents`.** Reading
  only the seat's own list is the recurring bug here, and those two
  location-equipments are exactly the case that would have been missed.

Both burns read their target TOTALLY at resolution (`findMinion`,
`controllerOfEntry`): the target was fixed when the card was played and
can be gone by the time it resolves — the Crypt's Sons crash from wave 4,
one wave later.

### Wave 8 — legacy cost-modifier masters (7 cards), 2026-09-09

Library **508 → 515**. Therbold Realty, Centralized Background Check,
Bureaucratic Overload, and the four Path masters (Metamorphosis, Night,
Paradox, Typhon).

**The question that matters is WHOSE cost changes.** A seat-level
`playCostMod` reaches every Methuselah unless it says otherwise, so
"locations cost YOU 1 less" (`controllerOnly`) and "weapons cost an
additional pool" (everyone, its own controller included) are different
scopes written in almost the same words. Getting either backwards charges
the wrong table and nothing throws, so both are asserted in both
directions.

**One new knob for four cards:** `vulnerableTo.actorDamage`, for
*"…as a Ⓓ action that inflicts 1 unpreventable environmental damage on
acting vampires"*. It is the mirror of `bearerPenalty` — a price on the
ACTOR rather than on the card's bearer — and it goes through
`damageAfterAction`, the Daring the Dawn path, so it lands after
resolution and cannot be prevented. VAMPIRES only: an ally may take the
action and pays nothing, which is what the card says.

**A measurement worth recording: the legacy masters have no families.**
Clustering all 380-odd by normalised text shape found **no group of three
or more**. The hunting-ground and Praxis-Seizure multiplier does not
repeat here — from now on masters are hand-picked, a few per wave, and
the Path four are the largest family left.

**The Path masters' discount matches nothing today** (no card in the pool
requires Vicissitude, Obtenebration, Chimerstry or Serpentis) — the Wall
Street Night precedent, and fine under §0 because the card does
everything it prints. Their CLANS were checked the other way: a filter
naming a clan no vampire has would be the "Assamite" bug, so the test
asserts Tzimisce, Lasombra, Ravnos and Ministry all exist in the crypt.

### Wave 9 — legacy action modifiers (4 cards), 2026-09-09

Library **515 → 519**. Mantle of the Moon, Stiff Contempt, Spoils of War,
Acheron Vortex. Four cards, four small extensions:

- **`blockRestriction.who: "all"`** — "this action is unblockable" is the
  UNION of the two kind bars, not a new kind of state, so every site that
  already reads them is right with no change of its own.
- **`blockCost.kinds`** — and this one is load-bearing. "VAMPIRES must
  burn 1 blood to attempt to block" without a kind filter reaches allies,
  and an ally facing a blood-only toll *cannot pay and so cannot block at
  all* (p. 22). The card would read "vampires pay 1" and behave as
  "allies cannot block". Checked before the allies-cannot-pay-blood rule
  for exactly that reason.
- **`modifyAllIntercept.exemptDisciplines`** — Acheron Vortex spares
  minions with Necromancy or Obtenebration. Nothing in this pool carries
  either, so the exemption spares nobody today; the test gives a vampire
  `nec` by hand so the exempt branch actually runs rather than sitting
  inert until a legacy crypt wave lands.
- **`actionGainPool`** — the pool twin of `actionGainBlood`.

#### The bug this wave found in itself: two switches, one question

`actionGainBlood` had a case in `applySuccessEffects` — the ACTION-CARD
success path — and none in the action-MODIFIER apply path. Spoils of War
is a modifier, so it paid nothing and threw nothing. Both switches now
answer it. This is the "one question asked in two places will drift"
shape, caught only because the card was tested end to end rather than by
asserting its spec.

#### A test that passed for the wrong reason, caught by a seat check

The first Mantle of the Moon assertion — "no block options are offered" —
passed while the decision still belonged to ALICE, in the as-played
window, before the card had done anything. An action modifier's effects
land when that window CLOSES. The tests now assert `dp.seat === "Bob"`
before reading the block list, so the same mistake cannot pass again.

### Wave 10 — legacy referendum reactions (3 cards), 2026-09-09

Library **519 → 522**. Surprise Influence, Conflict of Interests,
Irregular Protocol.

All three are played by a NON-CALLING seat during the polling step
(p. 28) — machinery the V5 abstain cards already built, and the polling
enumerator already offers reactions to those seats. **Surprise Influence
needed nothing new at all.** The other two added three flags to
`forceAbstain`:

- `sameClanAsReactor` — "a vampire who belongs to the same clan as this
  REACTING minion", a filter against the card's player rather than a free
  choice.
- `callingMinionOnly` — "force THE ACTING vampire to abstain": one
  target, named by the referendum.
- `lockSelf` — "LOCK THIS REACTING VAMPIRE to force…", the mirror of
  `lockTarget`. Getting those two the wrong way round locks the wrong
  minion and still abstains the right one, so only the lock state tells
  them apart — which is what the test reads.

Both cards also carry *"cannot be used during a referendum that is
automatically passing"* [PIB 20150105]: an auto-passing referendum casts
no votes, so there is nothing to cancel. Carried per card rather than
applied to every abstain, because the two V5 cards using this effect do
not print the ruling.

**The as-played lesson from wave 9 repeated**, and the tests were written
for it this time: a reaction's effects land when its as-played window
CLOSES, and the polling step then resumes with the CALLER rather than
with whoever just played. Both are driven generically instead of assumed.

### Wave 11 — legacy action cards (6 cards), 2026-09-09

Library **522 → 528**. Computer Hacking, Vermin Channel, Art Scam, Dark
Mirror of the Mind, Kindred Intelligence, Forgery — numbers on a card,
and a number that never reaches the table is the quietest failure there
is, so all six are asserted through a real action rather than a spec.

Only one extension: `cryptToUncontrolled` reached the ACTION path.
Kindred Intelligence and Effective Management (wave 7) carry **the same
ruling** — *"cannot be played when the target crypt is empty"*
[RTR 20000501] — so one effect now carries one gate on both sides of the
card-type divide.

#### Two dead ends in the strike enumerator, found by the fuzz

Adding six cards reshuffled every seeded game and seed 8 stopped with
**no legal options at all** in `combat.chooseStrike`. Both causes were
latent, and the second is the one that mattered:

- **The weapon compiler duplicated the engine's "whose strike is it"
  rule** — and got it wrong. It read *"`strikes.acting === null` means it
  is the acting side's turn"*, which is true in a normal round and FALSE
  in an additional sub-round, where only the minions with additional
  strikes strike (p. 32) and a non-participant's `strikes[side]` stays
  null for the whole sub-round. An opposing bearer with the extra strike
  was offered nothing. It now uses the same rule as `nextStriker`. This
  is "one question asked in two places will drift", exactly.
- **A commitment can outlive the card it names.** The AK-47 rider commits
  the strike to the gun; if the gun is burned in between, the commitment
  bars the hand strike while the gun offers nothing. A commitment to a
  card that has left play is now no commitment.

Together those two produced an option list of length zero — a state the
fuzz asserts against directly, and one that no card test would have
reached. The fuzz's failure message now names the seat, the window and
the frame stack.

### Wave 12 — legacy rush and burn actions (4 cards), 2026-09-09

Library **528 → 532**. Arson, Bum's Rush, Ambush, Entrenching. Three of
them needed nothing new: `actionOnPermanent`, `actionEnterCombat` with
its maneuver rider, and `delayedReplace: "afterAction"` were all already
there. Entrenching added one flag, `actionGainBlood.ifActorBloodAtLeast`,
read at RESOLUTION on a total lookup — blood spent getting there counts
against the threshold.

#### Ambush's ruling exposed a gap in a V5 card

*"If the action is unblocked when it resolves and the target is unlocked,
the action fizzles (the cost is paid, it counts as successful, but no
combat occurs)."*

"Enter combat with a LOCKED minion" is a gate at ANNOUNCEMENT **and again
at RESOLUTION** — the target can unlock in between. Only the first half
existed: `lockedOnly` filtered the option list, and the rush then started
combat on success without re-reading it. **Fleetness superior (V5) prints
the same clause and had the same gap**, so this was a live defect in the
existing pool, not something the widening introduced.

`ActionFrame.rushRequiresLockedTarget` now carries the clause to
resolution, where the combat is skipped and the action still succeeds.
The test asserts the fizzle AND its control — the same trace without the
unlock, which must still fight, or the fizzle test would pass for a card
that never rushes at all.

**This is the second wave running where a legacy card's RULING found a
V5 card's missing half** (wave 11: the same empty-crypt gate on two card
types). Reading the rulings is doing more than filling in the new cards.

### Wave 13 — legacy political actions (5 cards), 2026-09-10

Library **532 → 537**. Transfer of Power, Tithings, Diversity, The Final
Nights, Consanguineous Condemnation. The first wave into the POLITICAL
ACTION bucket, which is 135 cards and the third-largest in tranche 1
after the masters and the plain actions.

Wave 6's `refPerMinion` counts minions INSIDE a seat. These five ask a
question ABOUT the seat, which is a different shape:

- **`refStealPerSeat`** — "you steal 1 pool from each Methuselah who
  \<condition\>" (Transfer of Power: richer than you; Tithings: controls
  no vampire above capacity 6). A steal is a TRANSFER, so the two halves
  are computed per victim: a seat with less than the card asks gives what
  it has, and the caller gains only what actually moved. The condition is
  read for every seat BEFORE any pool moves — otherwise taking from the
  richest seat first would change who is "richer than you" partway down
  the table.
- **`refClanDiversity`** — "each Methuselah gains X pool, where X is the
  number of CLANS to which his or her ready vampires belong". A tally of
  distinct clans, not of vampires. Three ready Brujah are one clan.
- **`refLockClan`** — "choose a clan; successful referendum locks all
  vampires of that clan", sharing Consanguineous Boon's terms
  enumeration: the clans in the POOL, not the ones on the table (p. 49).
  One question, one enumeration.

#### The first failure clause in the pool

The Final Nights prints *"If this referendum fails, the acting vampire
burns 1 blood"*, and nothing in the pool had a clause for a referendum
that did NOT pass. Neither existing hook could carry it:
`applyReferendum` is by contract never called for a failure, and
`onReferendumLost` iterates cards IN PLAY, while the calling card is in
the ash heap by then. So `CardHandler.applyReferendumFailed` was added as
the mirror of `applyReferendum`, called on the calling card's own
handler.

A CANCELLED referendum is still not a failed one
(`docs/abstain-gate-design.md`): it never resolves, so the hook never
fires for it, which is exactly what "if this referendum fails" says.

**The first version of that call threw on every blood hunt.** A blood
hunt is a referendum with no calling card and an empty `cardName`, which
`handler()` raises on — the guard the neighbouring line already spelled
as `rf.cardInstanceId &&`. Five test files went red at once. It reads the
registry directly now, so a referendum with no card simply has no failure
clause. **A new call beside an existing one should copy its guards before
it copies its shape.**

### Wave 14 — the political removal family (5 cards), 2026-09-10

Library **537 → 542**. Command of the Harpies, Excommunication,
Sacrifice, Permanent Vacation, Screw the Masquerade!.

Four of them are "choose a ready \<filter\>, then take something away
from it", which is one primitive, `refRemoveChosenMinion`, with four
filters and **three outcomes that are not interchangeable**:

| Outcome | What is left | Reachable afterwards |
|---|---|---|
| `loseTitle` | the minion, untitled | yes, it is still in play |
| `burn` | nothing in play | yes, from the ash heap |
| `removeFromGame` | nothing at all | **no** — p. 16 |

Burned and removed look identical on the table and differ entirely in the
ash heap, so both are pinned, and the removal is asserted against the
EVENT LOG as well: an absent name in an ash heap is empty for two
possible reasons, and only the log says which.

Screw the Masquerade! is the fifth, and it extended `refChooseSeatsBurn`
rather than adding a primitive: `chooseExactly` (the card says "choose A
Methuselah", where the primitive's default is any non-empty subset) and
`everySeatBurns` ("each Methuselah burns 1 AND the chosen burns an
additional pool" — the chosen seat pays both).

#### Tradition Upheld was pulled from this wave: the pool has no Caitiff

The wave was originally built with **Tradition Upheld** ("choose a ready
Caitiff … burn that Caitiff"). It compiled, its tests passed, and
`clan-vocabulary.test.ts` then failed it: **no vampire in the pool is
Caitiff.** 36 legacy vampires are, and none of them are in the V5 sets,
so with the crypt still V5-only the card could never find a target.

That is not a partial card — it does everything it prints — but it is an
**inert** one, which "No partial cards" (§0) exists to keep out just as
firmly: a card that can never do anything is a card that plays wrong the
moment somebody puts it in a deck. It was replaced with **Sacrifice**,
which wants the same primitive and the same burn outcome but filters on
*the same clan as the acting vampire* — relative to the caller, so it
stays correct however the crypt widens.

**Tradition Upheld is deferred to §7**, and it enters the pool for free
the day any Caitiff group opens. The guard is what caught this, and it
caught it for exactly the reason it was written: the lesson in CLAUDE.md
about registry-derived sets naming their card kind was learned on a clan
filter that named a clan the registry did not have.

### Wave 15 — the pay-to-keep sweeps (3 cards), 2026-09-10

Library **542 → 545**. Jericho Founding (locations), Kindred Segregation
(allies), Peace Treaty (weapons). One referendum burns a whole category
off the table, and every Methuselah is asked, card by card, whether to
ransom theirs at its printed pool cost.

`refBurnAllKeepable` raises **one choice frame per card**, which is the
largest fan-out of frames any card in the pool produces. Three decisions
shaped it:

- **The question precedes the burn.** Nothing is burned in
  `applyReferendum`; the burn lives in the answer. This is the Rutor's
  Hand rule — a ChoiceFrame raised during resolution only queues, and the
  obvious build there asked after the damage had landed. A ransomed card
  is therefore one that never left play, which the test asserts by the
  absence of any burn event rather than by a count.
- **Mandatory with two answers, not optional with a decline.** A declined
  optional choice is a plain `pass` the handler is never told about, and
  the burn lives on the decline.
- **Affordability is read at ANSWER time, not at raise time.** An earlier
  answer in the same sweep can spend the pool a later one needed. A seat
  that cannot pay is still asked and is offered only the burn, which is
  an option list that is short for the right reason.

#### The fuzz found a pre-existing hole in strike resolution

Adding these three to the fuzz decks turned seed 1 red with
`unknown minion` out of `strengthOf`, and stashing the deck change turned
it green again — the CLAUDE.md prediction exactly: *a green fuzz before
and a failure after usually means a pre-existing latent bug just got
dealt in.*

`inflict()` read both combatants with `getMinion`. **Strikes are chosen
in one window and resolved in another**, and a combatant can leave the
table in between — an ally paying a cost with the life that IS its blood,
a burn, a removal. The gap predates this wave by a long way; a card that
burns allies from outside combat simply made it reachable. `inflict` now
returns when either combatant is gone, which is also the right rule: a
minion no longer in play neither strikes nor is struck.

#### A stale deviation, corrected

CLAUDE.md's known-deviations list still named *"Rutor's Hand's
pay-to-opt-out"*. The card's own comment says it was completed
2026-09-03, `optOutBlood` is on its superior mode, and
`partial-support.test.ts` records the closeout. The line was removed. **A
deferral is a claim about the code as it was**, and this one had been
false for a week.

The tranche-3 backlog measured from the raw snapshot is **1,206** rather
than the 1,130 in the table above; the difference is 3 Conviction cards
(Imbued, out of scope) and cards this plan's earlier count classified by
a slightly different discipline test. Re-derive it rather than trusting
either number.

### Wave 22 — the combat retainers (3 cards), 2026-09-11

Library **579 → 582**. Vengeful Spirit, Zombie, Resplendent Protector.
Full write-up: `docs/combat-retainers-design.md`.

Three retainers whose whole content is what they do once a fight starts —
and between them they cover every way a retainer can be involved in one:

| shape | card | needed |
|---|---|---|
| hits each round | Vengeful Spirit | **nothing** — `combatRoundDamage` is six waves old |
| prevents, and is NOT spent | Resplendent Protector | a per-COMBAT latch |
| IS spent, for something outside the fight | Zombie | a granted action priced in the card granting it |

Vengeful Spirit is in the wave BECAUSE it needed nothing: it is the
control that says the other two are not more of the same.

#### What the other two found

`retainerAbilities.lockToPrevent` existed, but it is **paid for by
locking the retainer**; Resplendent Protector's "prevent 1 damage each
combat" is not paid for at all. A rate is not a cost, and reusing the
lock would have made the card lock itself — losing the retainer's other
work every time it prevented. `preventPerCombat` differs only in the
latch (`usedThisCombat`), which is exactly what the card says.

`grantedAction` had six arms and none could be **priced in the card
offering the action**. Zombie's "burn this retainer to gain 2 blood" is
not `addBlood` with a cost: after paying, the action's own source is
gone. Hence `burnSelfForBlood`, which resolves blood first and burns
second, and reads its target with `findMinion` because the employer can
leave play between announcement and resolution.

**Deferred:** Ghoul Retainer and Duma Rafiki (a retainer wielding a weapon
outside the strike system, and a choice at strike resolution); Razor Bat,
Elephant Guardian and Stone Dog, which are Gargoyle- and Laibon-gated and
therefore **inert by §0**.

### Wave 21 — referendum outcome riders (4 cards), 2026-09-11

Library **575 → 579**. Elder Kindred Network, Bribes, Malkavian Rider
Clause, Cryptic Rider. Full write-up: `docs/referendum-riders-design.md`.

Four cards played while a referendum is live whose effect waits for the
RESULT. `postTally` already carried a payload past the tally (Scorn of
Adonis) — but its doc comment says "whatever the outcome", and that was
the gap: **no rider could ask which way the vote went**, and none read
`margin`, though the field had been on the frame since the margin wave.

#### The engine gap: a card's rule was living in the engine

Two of the four grant "the next referendum a vampire you control calls
passes automatically". `SeatState.autoPassReferendum` existed for Día de
los Muertos — as a BOOLEAN, with that card's condition written into the
consumption site: `if (flag && caller?.sect === "sabbat")`. Día de los
Muertos says "a SABBAT vampire"; the two new cards name no sect, so
neither could ever have fired. The flag is now a record carrying the
granting card's own conditions (`{ sect?, thisTurnOnly? }`), and the
engine only asks whether they are met — which also let Malkavian Rider
Clause keep the fact that it does NOT say "this turn", so its grant
survives `TurnBegan`.

A smaller trap: the polling-step branch of the compiler handles its own
effects and returns, so Bribes' plain "gain 1 pool" sitting beside its
rider was silently skipped. The rider worked; the card paid nobody. Only
asserting the two halves separately made it visible.

**Deferred:** Poison Pill (needs pool loss attributable to a referendum's
own effect), Aura of Invincibility (a counter permanent), and **Political
Backlash** — "only usable when a referendum FAILS", which has nowhere to
be played because the after-resolution window opens only on a PASS. That
gate is small; the branch behind it is caller-scoped and the card is a
reaction, so it lands in reaction timing and wakes. A wave of its own.

### Wave 20 — the basic combat cards (5 cards), 2026-09-10

Library **570 → 575**. Dodge, Fake Out, Boxed In, Dead-End Alley, Open
Grate. Full write-up: `docs/basic-combat-design.md`.

Five cards whose whole text is one of the three things any minion may
already do in combat — dodge, maneuver, press — with no Discipline, no
cost and no rider. The effects are as old as the combat kernel; what
makes them a family is **what a card with no requirement pays instead**.

#### The engine gap: a deferral one window too late

Three of the five print "**do not replace until after combat**", and
`delayedReplace` had `unlock`, `afterAction` and `discard` but not this.

`afterAction` would have compiled and looked right. It is wrong by
exactly one window: **combat ends before the action it happened inside
resolves** — a blocked action still has its resolution ahead of it — so a
card deferred to "after the action" comes back one step late, and
anything played in that window sees a hand a card short.

So `drawAfterCombat` lives on the COMBAT frame and is flushed at the
engine's single `CombatEnded` site: combat ends four different ways, and
a deferral flushed at three of them is a card that never comes back.
Outside combat the clause has nothing to wait for, so the card replaces
normally.

The other two carry a usage restriction instead of the deferral, which is
the comparison worth having in one wave. Open Grate's "only usable to
**end** combat" needed a new `press.endOnly` gate, and p. 32 makes it
narrow: a press never ends combat directly, it can only cancel one that
is standing. The three press cards partition that one step between them,
so each one's absence is another's presence at the same moment — which is
what the negative-space tests assert.

### Wave 19 — the Crusades (12 cards), 2026-09-10

Library **558 → 570**. The twelve Crusades whose whole text is the Praxis
Seizure in the other sect. Full write-up: `docs/crusades-design.md`.

**Expected to be pure data; wasn't.** §0 passed easily (48 crypt cards
print a `Sabbat:` line, and sect is parsed off that text at import — note
there is no `sect` field on a registry crypt entry, which is a trap for
the obvious query). Everything else was built: `requiresSect`,
`refPutInPlay`, the archbishop title at 2 votes.

#### The engine gap: `TitleGranted` never recorded the city

`titleContestKey` keys prince, baron and archbishop on the **city alone**
— p. 39, "contested by another vampire who claims ANY title to the same
city", with p. 41 ruling archbishop the same way. It reads
`MinionState.titleCity`, and nothing that grants a title from a CARD ever
wrote it: the field had exactly two writers, the crypt importer and test
fixtures.

So every Praxis Seizure prince since wave 13 keyed on `null` and
contested with nothing. It looked right because wave 13 fixed the OTHER
uniqueness — card-level `isUnique`, which makes two copies of *Praxis
Seizure: Chicago* contest — and prince-against-prince was the only
card-granted contest the pool could reach. An archbishop is a different
card claiming the same city, which card-level uniqueness cannot see.

`TitleGranted` gains an optional `city`; `refPutInPlay` carries
`grantsTitleCity`. The city was already in the permanent's tag
("Prince of Chicago"), where nothing that mattered could read it. The
thirteen Praxis Seizures are fixed by the same line.

**Eleven Crusades stayed out**: each adds a rider naming a clan or a
vampire the pool lacks (Tzimisce, Lucita), which would be an inert clause.

### Wave 18 — the Discipline masters (5 cards), 2026-09-10

Library **553 → 558**. Animalism, Auspex, Fortitude, Presence,
Thaumaturgy. Full write-up: `docs/discipline-masters-design.md`.

**Twenty lines of data and no new primitive.** The factory has existed
since `derived-traits-design.md`; the content of this wave is *which five*,
and that turned out not to be a preference.

A Discipline master granting a Discipline no card in the pool requires is
**whole and inert** — the Tradition Upheld shape — so §0 decides the wave
by a set difference over the registry: the supported library requires
eleven Disciplines, six already had their master card, and these are the
other five (each required by 45–79 cards in the pool). The nine remaining
Discipline masters grant Disciplines nothing asks for and stay out until
§7 opens the clans that use them, at which point they cost nothing.

Worth noting the §0 question ran **backwards** here. Usually it asks "can
the pool produce a target this card names?"; this asks "can the pool USE
what this card gives?". Same rule, and the answer was a query rather than
a judgement — which is why it became the wave's one new test, written as a
**reason** (granted == required) rather than as a count.

**This wave found no engine defect** — the first since wave 11 that did
not, and said so rather than dressing something up. It did correct a false
claim in `CLAUDE.md`: "zero melee weapons are in the pool", carried from
wave 16 and repeated in wave 17, was never true (ten are, all tagged
`melee`). It came from a bad registry query and was never re-derived.

### Wave 17 — the aim cards (3 cards), 2026-09-10

Library **550 → 553**. Target Hand, Target Head, Target Leg. Full
write-up: `docs/aim-design.md`.

The second wave into the **Combat** bucket, and the family wave 16 passed
over — correctly, at the time: the four aim cards do share a wrapper and
need four different payloads. What made them a wave rather than four
builds is a trigger nobody had written down as shared. All four print
**"if any damage from this strike is successfully inflicted on the
opposing minion, …"**, and the engine had no way to hold a payload until
that moment.

#### The engine gap: a card already in the pool was not waiting

`Target Vitals` (shipped in the weapon-riders wave, tested, passing)
applied its "**they cannot press this round**" clause at PLAY time. The
`if` governs both of its clauses, and [RTR 19960221] says an aim "can be
played on a strike that does no damage, **even a dodge or a combat ends**,
but has no effect in that case" — so a Target Vitals played on a strike
the opponent dodged was still barring their press.

`CombatFrame.aimRiders` holds the payload and fires it at the damage
chokepoint, spent as it fires. Target Vitals moved onto it and got its
timing back; the three new cards hang four more payloads off the same
trigger.

#### Two damage bonuses that are not the same bonus

Target Head prints "**the strike does +2 damage**"; Target Vitals prints
"they take **+2 from this strike**" if damage lands. They read alike and
differ under prevention — against a 1-damage strike with 1 prevention,
Target Vitals inflicts nothing and Target Head inflicts 2. Folding the
first into the second would have made Target Head's bonus
**unpreventable**, and no test that counts damage would have noticed.
Hence `aimStrikeBonus` (inside `inflict`, where the ammo bonus lives)
beside the rider's own.

#### Restrictions are gates on OPTIONS

[LSJ 20011214-5] on Target Head is unusually specific — the barred minion
"cannot play a card that provides an additional strike, **even if just to
benefit from another effect**" — so the bar drops the option as well as
refusing the grant. Target Leg's "maneuvers or presses only if they
require Obfuscate, Blood Sorcery or Flight" takes every CREDIT (a rush
rider's maneuver, a weapon's, a press from a card in play: none requires
a Discipline) and filters card plays on the mode's own Discipline.

**Deferred: Target Retainer (101941)** — its other half is an ordinary
rider, but retargeting a strike at a **retainer** means addressing a
permanent from the damage path, which nothing does today.

### Wave 16 — the ammo cards (5 cards), 2026-09-10

Library **545 → 550**. Manstopper Rounds, Glaser Rounds, Scattershot,
Dragon's Breath Rounds, Caseless Rounds. Full write-up:
`docs/ammo-design.md`.

**The first wave into the COMBAT bucket**, which was 58 cards and
completely untouched. The family was picked over the Aim cards (Target
Hand / Head / Leg / Retainer) on the wave test in CLAUDE.md: one new
primitive should pay for the whole wave. Ammo does — the aim cards share
a wrapper but need four different payloads behind it, which is four
builds, not a wave.

**§0 was checked before anything was written**: four guns are in the pool
(.44 Magnum, AK-47, Assault Rifle, Sniper Rifle), so the family has real
targets and none of the five is inert. There are **zero melee weapons**
in the pool — worth knowing for a later wave.

#### The engine gap: declaration and resolution were one step

All five say "only usable before resolution of a gun's strike", and
[RTR 19990105] defines that as *after strikes have been declared but
before they resolve*. `settleCombat` ran `resolveStrikes` the instant both
strikes were in, so that moment did not exist.

The rulebook keeps the halves apart — strike declaration is ordered and
public, resolution is simultaneous (p. 30) — so this is a new **window
inside step 4**, `combat.beforeResolution`, not an eighth rulebook step.

It **opens only when a seat can actually use it**, the same recorded
deviation `combat.damageResolution` and `action.afterResolution` already
carry. That was not an optimisation but a requirement: this window sits
between every strike pair in every round of every combat, and cycling
four seats through an empty question twice a round would have added
decisions to the most-played part of the engine — and moved the trace of
every existing combat test. No existing trace moved.

#### A latent bug closed on the way

`isGunStrike` searched the whole table for a weapon by NAME and took the
first match — a wrong answer as soon as two minions in one combat carry
a .44 Magnum, which nothing prevents. Ammo needed to name a specific gun
anyway, so every weapon strike now records `Strike.weaponCard` and the
name search is only a fallback. It had been harmless because its one
caller set a cosmetic flag.

#### A rules reading, from p. 33

A dodge "cancels the effects of the opposing strike **on this minion**" —
so the ammo effects split by whose side they act on. The damage bonus is
cancelled by a dodge; **burning your own gun (Dragon's Breath) and
granting yourself an extra strike (Caseless) are not**, and they moved
out of `inflict` (which returns early on a dodge) into a pass over both
declared strikes.

#### What the existing tests caught

Both immediately, and neither was a bug in a card:

- `supported.test.ts` — Caseless Rounds costs **1 pool** and the spec
  omitted it. The metadata cross-check exists for exactly this.
- `render.test.ts` — `['ammo']` was missing from How to Play. A new
  printed keyword in the pool is a word players will see on a card, and
  the in-game rules now explain it beside Grapple, Aim and Boon.

Fuzz green on the first run with all five dealt in — no latent bug came
in with them, which after wave 15 is worth stating rather than assuming.

---

## §7 Phase 6 — the crypt abilities (1,104 cards)

**This phase did not exist until 2026-09-08, and its absence was a
mistake in this document.** §1 says widening the crypt is "nearly free",
and that is true of *admitting* a vampire — it is not true of making its
printed ability work. The plan costed the first and never costed the
second, which is how 1,104 vampires with inert abilities entered the pool
without a line item.

### The backlog

| | count |
| --- | --- |
| Crypt in the pool | 1,680 |
| Ability implemented | 99 |
| Needs no code — a bare sect/title line and nothing else | 477 |
| **Needs an implementation** | **1,104** |

Where they came from, which is the uncomfortable part:

| | needing an implementation |
| --- | --- |
| The original V5 sets | **0** |
| Phase 1 (groups 5–7) | 282 |
| Phase 2 (groups 1–4) | 822 |

**Before the widening the pool was already at 100% by §0's standard** —
444/444 library, and 217 crypt made whole by 99 implementations plus 118
cards that need none. Every one of the 1,104 arrived in the two phases
above.

### Sequencing

Spread across 35 clans, so clan-by-clan waves are the natural unit: a
clan is a coherent chunk of rules text, it shares disciplines, and
finishing one makes a real archetype playable rather than leaving 35
half-finished. Largest first — Banu Haqim 65, Toreador 61, Ventrue 59,
Gangrel 58, Tremere 55, Nosferatu 54 — or smallest first to bank whole
clans early. Either beats an arbitrary order.

**The library and the crypt are entangled**, and the crypt is the one
that should follow. 197 of the group 5–7 vampires alone carry legacy
disciplines (`nec`, `vic`, `chi`, `ser`, …) that no card in the pool yet
requires, so their abilities have nothing to interact with until §6's
tranche 3 lands. Implementing them first would mean testing abilities
against a pool that cannot exercise them.

### The size of it

At this project's demonstrated 15–25 cards per wave, 1,104 cards is
**roughly 50–70 waves** — comparable to the entire library effort that
produced 444/444. Added to §6's 1,920 library cards, full pool support at
§0's standard is the largest remaining body of work in the project by a
wide margin.

### The choice — DECIDED (a), 2026-09-08

Three ways out were put to the owner: **(a)** roll back and re-widen
behind the waves, **(b)** keep the pool and treat the 1,104 as declared
debt, **(c)** keep only what is whole. **The owner chose (a).**

What was done:

1. **`config/crypt-groups.json` is `"groups": []`.** The registry is
   byte-identical to a V5-only build: **crypt 217, library 444, total
   661**, and every one of them whole.
2. **The wholeness gate is now in the BUILDER**, not in the discipline of
   whoever edits the config. `widenedCrypt` admits a vampire only when
   `isWhole()` — implemented, or printing no ability at all. Opening a
   group can no longer admit a card whose text does nothing, which is
   exactly how the 1,104 got in.
3. **`tests/cards/no-partial-cards.test.ts` asserts §0 over the whole
   registry**, not just the widened part: every entry is implemented, or
   is a crypt card printing no ability. It carries its own control — the
   two whole kinds must ACCOUNT FOR the entire pool and both must be
   non-empty — so it cannot pass on an empty or half-built registry.

**The gate is proven, not asserted.** Re-opening groups 5–7 as a dry run
admits **59** vampires where the ungated widening admitted 341, and all
59 are whole. That is the pipeline working: the config says where to look,
§0 says what may come through.

### How to widen from here

Widening is now a consequence of card work rather than a decision of its
own:

1. Implement a clan's abilities as a normal card wave (CLAUDE.md,
   "Adding a card"), flipping ids in `config/supported.json`.
2. Open the groups you want in `config/crypt-groups.json`.
3. `npm run cards:registry`.

Every vampire whose ability landed in step 1 comes in; every one that did
not, does not. The count goes up as the waves land, and it can never get
ahead of them.

---

## §9 Phase 8 — the deck importer and the browser

Not last for difficulty, but it must follow the pool. Once the pool is
wider than the V5 precons, the importer's error messages carry more
weight: a rejected deck should say *which* cards are unimplemented and
whether the deck would be legal otherwise. That surface already exists
(`unknown` / `unsupported` / `inertAbilities`) and mostly needs the
screens to use it well.

---

## §10 Out of scope unless the owner says otherwise

- **The Imbued** — 20 crypt cards plus 17 Power/Conviction library cards.
  A separate subsystem with its own resource (conviction), its own card
  types and its own rules. Not a widening; a second game mode. Recommend
  excluding explicitly rather than letting `isCryptRaw` admit them by
  accident (§2.3).
- **Clan-change and sect-change** — already a recorded deviation.
- **Translating legacy disciplines** — see §4(b).

---

## §11 What to do first

If the plan is accepted, the smallest useful slice is **§2 + §3**:
groundwork plus groups 5–7. That is a config split, one filter line,
two small decisions, and 347 vampires. No engine work, no card waves,
fully reversible, and it makes the political game noticeably richer
immediately because titles are votes.

Everything after that is a choice about how much of the library is worth
the months it costs.
