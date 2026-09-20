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

### Wave 84 — conditional reactions (3 cards), 2026-09-20

Library **805 → 808**. Steadfastness, Sonar, Dread Gaze. Write-up:
`docs/conditional-reactions-design.md`.

Three reactions conditioned on WHAT is being answered — two on a directed
action, one on a referendum. Every primitive existed, including the
`actionDirectedAtYou` gate under that exact name, so the cards were nearly free.

**Five of the nine candidates are INERT** and stayed out: Covincraft needs a
Kiasyd, Truth in Ink and Watch Commander a Black Hand vampire, Their Master's
Voice a Gargoyle, Mistaken Identity a Ventrue antitribu — none in the crypt.

New: `delayedReplace: "turn"`. Every existing deferral hangs off a frame the
player owns or an event, but **a reaction is played on somebody else's turn**, so
"the current turn" is THAT turn and not the reacting seat's own discard phase
(which is what `delayedDrawsDiscard` waits for, a whole round later).

**What the fuzz found: two blood-vote offers collide.** Seed 6 went red with a
duplicate `vote:blood:Ae:for`. The enumerator loops offers and, inside, every
qualifying minion — and **two cards can each install an offer** (Mob Rule and
Rant!), so a vampire qualifying under both was enumerated twice under one id.
Nothing before this wave dealt both to the same table. The offer index now rides
in the option ID and `source` deliberately stays `blood:<minion>`, because
`source` is the bookkeeping key `bloodVotesBought` and `maxBloodPerMinion` count
against.

**Rules question for the owner:** with two offers in play, may a vampire buy
under both? The fix offers both options (the conservative reading — it does not
collapse two permissions into one), but the per-minion cap is shared.

Fixtures were most of the cost: intercept is only offered when NEEDED and stealth
only during a live block attempt, both gated on the same thing, so a directed
action with stealth on it takes the real back-and-forth. Six of nine assertions
failed first time from counting impulses; all are walkers now.

### Wave 83 — avoiding the block (3 cards), 2026-09-20

Library **802 → 805**. Uncontrolled Impulse, Walk through Arcadia, Horrific
Countenance. Write-up: `docs/avoiding-the-block-design.md`.

**First bucket change in nine waves** — Action Modifier rather than Combat.
Three cards that buy the same thing (not being blocked) at three prices: the
turn's first action, a coin flip, and 4 blood after the block has happened.
`restrictBlocking("all")` already meant "unblockable", so two of the three
needed no new way to say it.

New: a turn-frame count of NON-MANDATORY actions (incremented at announcement,
the only moment that can tell a mandatory hunt from a chosen one, because the
blood is still 0 there); and the pool's **first coin flip**, through
`ops.randomIndex` so replays and the fuzz's log-replay stay honest.

Several nearby cards are INERT and stayed out — Strange Day, Dusk Work,
Excellent Thirst, Neebi all need a Laibon or Aye, and the pool has neither.

**No engine defect. The cost was entirely in the fixtures**, and that is the
finding worth keeping: six of nine assertions failed first time, every one an
assumption about WHERE a modifier is offered. A modifier lives in
`action.effects`, not `action.announce`; a STEALTH modifier is only offered while
a block attempt is underway (p. 26), which is one window further again;
`threeSeatGame` gives Alice one minion; and **a fixed trace between announcement
and resolution is a guess** — the helper is now a walker, because a trace one
step short leaves the engine mid-action with nothing to show it.

Mutation-checked per wave 79: turn gate widened, coin forced to heads,
unblockable dropped — four failures, clean on restore.

### Wave 82 — after-combat payoffs (3 cards), 2026-09-20

Library **799 → 802**. Flesh Bond, Mercy for the Weak, Torrent. Write-up:
`docs/after-combat-payoffs-design.md`.

Three "combat ends" cards, two carrying a payoff that lands after the combat.
New: a `gainBlood` after-combat rider ("opposing vampire gains 1 blood, even at
long range") and an `onlyIfMoreBloodThanFoe` gate — the only card in the pool
that compares the two combatants' blood, strictly and only against a VAMPIRE,
since an ally has life in the same field.

**What the wave found: a ruling that cannot yet be modelled, and why.** Both
cards carry [RTR 20020501] — the payoff does not happen if an effect CONTINUES
the combat. It was built first (a rider flag discarded at the round boundary),
and then the test for it failed, which was the useful part: **nothing in the pool
can continue a combat that a combat-ends strike ended.** A press cannot — the
strike ends the combat at strike resolution and the press step never arrives —
and the pool's one continue-the-combat card (Hunting the Quarry superior) is
gated `onlyIfCombatWouldEnd`, which by definition excludes a PREMATURE ending.

So the machinery was **removed rather than shipped untested**, and the two tests
were rewritten to pin the PRECONDITION: a press does not continue such a combat,
so the payoff lands. The cards are whole without it — the cancellation is not
printed on either one; it is an interaction with cards not in the pool (the
ruling names Psyche!).

`docs/after-combat-payoffs-design.md` §3 records what to build the day such a
card is admitted. That is wave 72's deviation-as-a-claim-about-the-pool shape,
written down deliberately this time rather than discovered later.

### Wave 81 — the shape of the round (4 cards), 2026-09-20

Library **795 → 799**. Vanish from the Mind's Eye, Sanguinary Wind, Rapid
Thought, Relentless Pursuit. Write-up: `docs/round-sequencing-design.md`.

Four cards that change how the ROUND runs rather than what a strike does. Three
new round-scoped mechanics, each earned by one card:

- **Who chooses a strike first.** `nextStriker` hard-coded "acting, then
  opposing" (the p. 30 default); Rapid Thought's superior flips it for the
  round. The gate is the interesting half — "only if this vampire WOULD choose
  first" — and because the swap makes the other side first, the card can never
  be played twice. Asserted, including that it is absent from Alice's list after
  the swap.
- **Strikes undodgeable for the round.** A third source folded into the one read
  in `resolveStrikes`, beside the Strike's own flag and the striker's static —
  and NOT a gate on the dodge option, because "the dodge just has no effect"
  [LSJ 20030902-2]. The card's two modes differ only in WINDOW, so the effect
  carries the window as data.
- **A grant that depends on what happens next.** "If another round starts, you
  get +2 hand size" cannot be answered when the card resolves — the press it
  rides on is what might start the round — so it is owed at play and paid at the
  round boundary.

Vanish needed nothing new and is the control: its RESTRICTED press is the basic
and the free one the superior, so a gate applied to the card rather than the mode
would show there.

Mutation-checked per wave 79: all eleven green first time, so all three
mechanics were broken in one pass — five failures across the three, clean on
restore. Note from doing it: the restore of one read did not match by string
replacement and needed the editing tools. **Shell surgery is fine for making a
temporary mutation and unreliable for undoing it** — check the restore.

### Wave 80 — thaumaturgy ranged strikes (3 cards), 2026-09-20

Library **792 → 795**. Drain Essence, Eldritch Glimmer, Machine Blitz.
Write-up: `docs/thaumaturgy-strikes-design.md`.

Three [tha] ranged strikes whose AMOUNT is not a printed constant — one steals
blood, one buys damage with blood (`perBloodX` on `strikeDamage`, the shape
`prevent` already used), one reads its number off the opponent's weapon.

**The first wave where the RULINGS did the design work** rather than confirming
it, and it was cheap because each one pointed at machinery that already existed:

- Machine Blitz's X is `weaponProfile.damage`, whose own doc comment cites the
  same ruling [RTR 19980623] — it was built for Concealed Weapon's threshold and
  this card is its second reader.
- X is captured **at announcement** [LSJ 19970224], the opposite of
  `strikeWeaponCost` (Up Yours!), which reads at resolution. Both are right: a
  printed pool cost cannot change between the two moments and a weapon's current
  damage can.
- It is **not a use of the weapon** [LSJ 20010806-1] — no burn-after-use, no
  once-per-combat, not aggravated — so it never touches the weapon-strike path.
  Asserted by the weapon still being attached afterwards.

One gate deliberately NOT added: "can target a minion with less blood than the
amount stolen" [RTR 20010711], so Drain Essence is offered against a 1-blood
victim and takes the 1. Asserted, because that is the kind of gate added for
tidiness that then makes a card unplayable in the case it was printed for.

Mutation-checked per wave 79's method: all nine green first time, so both new
amount calculations were broken on purpose — two failures, clean on restore.

### Wave 79 — strength, before range (3 cards), 2026-09-20

Library **789 → 792**. Fists of Death, Song of Serenity, Shadow of the Wolf.
Write-up: `docs/strength-before-range-design.md`.

Three cards played in the same window that all move STRENGTH, and between them
they complete a 2×2 the pool had three corners of: own/combat
(`addStrength`), own/round (`combatCredits.strength`), and now the OPPONENT's
in both scopes (`opposingStrength`, carrying a `scope` because one card prints
both).

**No new engine op was needed** — `addRoundStrengthTo` and
`addCombatStrengthTo` already take a MINION and resolve the side, because they
were written for in-play abilities with no `CardPlayFrame`. A negative amount on
the foe is those same ops. The minion-addressed form existing for another
reason is what made the new quadrant cheap.

`combatCredits` also gained `additionalStrike`: Shadow of the Wolf grants one
before range, and the standalone primitive lives in the choose-strike window —
using it would have offered the mode three steps after its own text allows.

**Method note, not a defect:** all ten assertions passed on the first run, which
waves 77 and 78 had both just been caught by. Instead of reasoning about it, the
penalty was temporarily flipped from `-1` to `0` and the suite re-run — **two
tests failed, then passed again on restore.** A mutation check is cheap and
conclusive where staring at assertions is neither; worth doing whenever a wave's
test file is green first time.

### Wave 78 — dodges (6 cards), 2026-09-20

Library **783 → 789**. Vampiric Speed, Staredown, Preternatural Evasion,
Sideslip, Acrobatics, Behind You!. Write-up: `docs/dodges-design.md`.

Six cards built on "Strike: dodge", which already existed — so the wave is
about what each buys ALONGSIDE the dodge and which window that lives in. Two
put their two modes in two different windows.

Small additions: a `bloodCost` on `strikeCombatEnds` (Preternatural Evasion
"burns 1 blood to end combat", the `preventAllThisRound` shape), and
`oncePerRoundAtSuperior` for Sideslip — which needed **no engine work at all**,
because `modeCombatLimit` has accepted `"round"` since it was written and
nothing had ever returned it.

**Behind You! is the card that finally checks wave 73's hoist.** That wave
found `onlyFirstRound` being read inside `combat.beforeRange` only and hoisted
it above the window switch, with nothing in the pool exercising it. Behind
You!'s basic is a MANEUVER, in `combat.range`, and carries the gate — so before
the hoist it would have stayed playable in round 2 with nothing to show it. Both
windows now assert it is withheld in round 2. **A hoist is untested until a card
needs it in the second window.**

**All 14 assertions passed on the first run, and one was passing for the wrong
reason.** "The second Sideslip is not offered" walked back to the damage window
— but the first Sideslip prevented the whole 1-point hit, `pendingDamage`
emptied, the window CLOSED, and the negative held against an empty list. M now
hits for 3 and the test asserts `pass` is on the table before claiming anything
is missing. Same lesson as wave 76's dodge that never happened: **a negative
needs the thing it negates to have been possible.**

### Wave 77 — bigger strikes (4 cards), 2026-09-20

Library **779 → 783**. Undead Strength, Pushing the Limit, Brute Force,
Cauldron of Blood. Write-up: `docs/bigger-strikes-design.md`.

Four cards that say "swing harder", three of them on a hand strike OR a melee
weapon strike. It looked like the cheapest wave yet — `strikeHandBonus` and
`orMeleeWeapon` both existed — and it found the most consequential defect so
far, in a card already in the pool.

**What it found: "or use a melee weapon strike" threw the weapon away.** The
card path built `{ damage: null, ranged: false, handBonus: <the card's bonus> }`
— so the weapon's own strike was discarded and replaced with a bare
strength-plus-bonus one. Every melee weapon in the pool is `damage: null,
handBonus: N`, so **Anticipation with a Righteous Blade dealt a point less than
it prints**, with a passing test asserting the wrong total. The weapon's strike
shape lived only inside the weapon compiler's closure; the handler exposed only
`weaponProfile`, a MEASURE for the AI. There is a `weaponStrike` beside it now.

Two things fell out of fixing it: a fixed-damage weapon ignores `handBonus` at
resolution, so a card bonus on a gun folds into the number instead; and
`ranged` now comes from the weapon, where it was hard-coded `false` — which
wave 76's Projectile ("or use a RANGED weapon strike") had just started
depending on.

Third wave running for the same shape: **a value welded into the site that
first needed it, invisible until a second caller arrives.**

Also new: `weaponBonus`, for Brute Force's weapon variant being worth more than
its hand variant (+1 hand / +2 melee). And a ruling the design already honoured
— Immortal Grapple's gate is per MODE, so the melee option survives it
[LSJ 20090114], now asserted.

The fixture lesson: the first draft attached an INVENTED weapon, which has no
registry entry and so no strike. "The weapon variant is bigger" quietly became
"the same". **What the fixture puts on the table has to be a thing the registry
knows** — wave 71's duplicate instance id, one level up.

### Wave 76 — undodgeable strikes (3 cards), 2026-09-20

Library **776 → 779**. Scorpion Sting, Earthshock, Projectile. Write-up:
`docs/undodgeable-strikes-design.md`.

Three cards whose point is that a DODGE does not answer them, which makes the
dodge the control. The flag sits on a hand strike, on a ranged strength strike
and on a fixed-damage-or-weapon strike, so one sentence is asserted against
three kinds of blow.

**Two engine findings, both about siblings that had drifted:**

1. **A strength-based strike was hard-gated to close range.** The
   fixed-damage branch of strike resolution consults `ranged`; the
   strength branch hard-coded `cf.range !== "close"`, because every card that
   had printed a strength strike so far WAS a hand strike. Earthshock's
   "strength RANGED damage" is the first that is not.
2. **"Hand damage is aggravated" reached it too.** Bone Spur and Claws of the
   Dead are applied in that same branch, so they would have promoted a ranged
   strength strike. Now gated on `!strike.ranged`; nothing pre-existing
   changes. **A branch that used to identify one kind of strike stops doing so
   the moment a second kind reaches it.**

Also `orRangedWeapon` as `orMeleeWeapon`'s sibling, and a flight gate for
Earthshock (flight only ever arrives from a card — no V5 vampire prints it).

**What the wave found in its own test:** the walker asked Bob to dodge and
**Bob never dodged** — a dodge is not a free option, it comes from a card, so
`strike:dodge` was always absent and the walker hand-struck instead. Six of
seven tests passed, including every undodgeable assertion, on a board where
nothing was ever dodged. It surfaced only because Scorpion Sting's basic is
*supposed* to be stopped. The walker now reports whether it dodged and the
helper throws if it asked and did not get one: **a control that can silently
not happen is not a control.**

### Wave 75 — stripping the gear (4 cards), 2026-09-20

Library **772 → 776**. Fractured Armament, Shattering Blow, Canine Horde, Fast
Hands. Write-up: `docs/equipment-stripping-design.md`.

Four strikes that take an opponent's equipment away. Most of the machinery
existed (`Strike.burnEquipment`, from Heroic Might); the wave's work was
reaching it from a card MODE rather than only from a granted strike, plus a
`stealEquipment` sibling that moves the card instead of burning it.

**Armor of Vitality is deliberately NOT here** — it is a prevention card, in a
different window, and it needs a fact nothing records yet: *which weapon dealt
this damage*. That belongs beside `PendingDamage.fromGun`, stamped at the push
chokepoint, and is worth a wave with the other cards that read it.

**What it found: "destroy equipment" could not also deal damage.** The
resolution burned the card and then returned unconditionally, so Fractured
Armament's "as above, with 1 damage" would have dealt none. The fix is the
guard its own neighbour four lines up already uses — `attachToVictim`
distinguishes "the attach IS the strike" from "the attach is a rider on a
damaging strike" the same way. **The guards around a line are part of what that
line means.**

Also: the test passed 12 of 12 first time and had **no assertion for
`firstStrike`**, a flag three of the four superiors print. All-green-first-time
was the tell. Added as a per-card pair, and it then failed three times before
passing — the same fixture fact as waves 73 and 74: **a card play's effects
happen in `resolve`, after the as-played window**, so nothing it does is
visible immediately after `choose`.

### Wave 74 — aggravated damage (5 cards), 2026-09-20

Library **767 → 772**. Burning Wrath, Song in the Dark, Bone Spur, Burst of
Sunlight, Adaptability. Write-up: `docs/aggravated-damage-design.md`.

Five cards about the aggravated FLAG in both directions — three put it on, two
take it off. **Raking Talons stayed out as INERT** (requires a Gargoyle; the
V5 crypt has none) and **Jua Vema** too (its superior needs an "Aye" nothing
in the pool produces).

Three small mechanics, each earned by a card: a **combat-long**
hand-aggravated flag beside the existing round one (Bone Spur's two modes
differ only in scope, and the round boundary has to clear one and not the
other); a **per-item** conversion for Adaptability, whose scope is one STRIKE
where Skin of Night's is the round; and an **aggravated-only** prevention.

**What it found: a strike rider welded to weapons.** Burst of Sunlight's "this
striking vampire also takes N aggravated damage" is already modelled —
`Strike.bearerSelfDamage` — but was reachable only from a weapon:
`chooseCardStrike` could not set it, and `oneShotRiders` opened with
`if (!strike?.weaponCard) return;`. **What a strike does to its own striker is
a question about the STRIKE.** Third instance in three waves of the same
lesson (`spec.weapon` inside `compileEquipment`, then the round gates inside
one window, now this).

Carried over intact from wave 72: neither conversion clears `aggravated`, so
Resilience's non-aggravated prevention still cannot touch converted damage
[LSJ 20040812-2] — asserted as a pair, with the basic mode still offered so
the gate is shown to narrow the MODE and not the card.

### Wave 73 — thrown objects (5 cards), 2026-09-19

Library **762 → 767**. Sacrament of Carnage, Thrown Gate, Mercury's Arrow,
Thrown Sewer Lid, Well-Aimed Car. Write-up: `docs/thrown-objects-design.md`.

Five ranged strikes with riders, two gated on the range and one also on the
round. **No new primitive and no new gate** — both mode-level gates already
existed (a first grep found only the weapon profile's copies and suggested
otherwise, which is "it already exists" being a claim to CHECK). The cards
are a lens; three defects came out of it.

1. **The round gates were each checked in ONE window.** The range gates had
   been hoisted above the combat-window switch; `onlyAfterFirstRound` and
   `onlyFirstRound` were left behind, so either clause printed on a card whose
   effect lives in another window did nothing. Well-Aimed Car's own gate
   worked by luck. Both are hoisted now.
2. **"…with an optional press" granted a COMBAT-LONG press.** All four strike-
   rider sites used `grantCombatPress`, though "the optional press can only be
   used during the current round" [TOM 19960521] — a ruling printed on
   **Backflip**, whose test asserted the wrong pool and kept the defect green.
   Same shape as wave 72's prevention credit, one field over: **when a family
   has two pools, check which one each member writes to.**
3. **The fuzz found a card in two zones at once.** `resolveCardPlay` files a
   played card unless it "went into play instead", asked at CARD resolution —
   and Molotov Cocktail puts itself in play at STRIKE resolution. It was filed
   AND attached, so every ash-heap card offered it twice and `onCombatEnded`
   burned it twice. Fixed at the chokepoint: `PermanentEnteredPlay` clears the
   card from every ash heap. The dodge case needs no special case — the card
   stays filed, which is what [ANK 20200203-1] says.

Also: the fuzz's duplicate-id error printed the DEDUPED id set, the one view
in which a duplicate is invisible. It now prints the ids that repeat.

### Wave 72 — the armour cards (5 cards), 2026-09-19

Library **757 → 762**. Skin of Rock, Resilience, Skin of Steel, Unflinching
Persistence, Skin of Night. Write-up: `docs/armour-design.md`.

Five [for] cards about TAKING damage. Four are existing prevention
vocabulary; the new primitive is `treatAggravatedAsNormal`, and a ruling
shaped it: Resilience "cannot be used to prevent aggravated damage **even if
the minion treats them as normal damage** (eg. Skin of Night)"
[LSJ 20040812-2]. So the conversion is recorded on the MINION and read only
where "aggravated" means "cannot be mended" (p. 34) — the damage item stays
aggravated, and the ruling holds by construction rather than by a special
case.

**What it found: a prevention CREDIT forgot two things, and one card exposed
both.**

1. **It outlived its own sentence.** `combatCredits.prevent` is documented as
   "this round only" and was written into the COMBAT-LONG pool, so Obedient
   Flesh's and Bear's Skin basic's credits always survived into later rounds.
   The tell was already in the tree: the covering test is *named* "ROUND-
   scoped … gone next round" and asserted the combat-long field. There is now
   a round pool, reset at the round boundary.
2. **It could not be Discipline-filtered.** `discipline-filtered.test.ts`
   carried an explicit recorded deviation — a credit is a bare count, so
   `noPreventBy` ("cannot be prevented by cards requiring Fortitude") cannot
   reach it — safe only while no credit-granting card required a Discipline
   the filters name. **Unflinching Persistence requires [for].** Admitting
   the card expired the deviation's own precondition. Each credit now carries
   its granting mode's disciplines.

A recorded deviation is a claim about the CARD POOL as it was, the same way a
deferral is a claim about the code. A wave can invalidate one without
touching anything the note described.

### Wave 71 — positional combat (8 cards), 2026-09-19

Library **749 → 757**. Fade from View, Gleam of Red Eyes, Form of the Ghost,
Nimble Feet, Quick Exit, Read Intentions, Movement of the Mind, Dissolution.
Write-up: `docs/positional-combat-design.md`.

**The first wave with NO new primitive, on purpose.** Every one of the eight
is a press, a maneuver, a dodge or an additional strike at two levels — all
vocabulary waves 1–70 built. That is what made it eight cards instead of
four for the same gate, and it is the shape the rest of the Combat bucket
should take: once a bucket's primitives are finished, the wave's job is to
DRAIN them rather than to add one.

Three of the eight print a press that may only **end** the combat, which the
`press.endOnly` gate already covered (Qetu). Dissolution's `maneuver OR
press` is two variants of one mode offered in two different windows — the
option list is the choice, so no frame is needed — and its superior is
`maneuver` plus a per-round press credit.

What it found: **a duplicate card-instance id is invisible to an "is it
offered" test.** The fixture pushed the card in as `{ id: "c1" }`, which
`threeSeatGame` already uses for Conditioning; the option was offered under
the right NAME and `choose` resolved the other card. Twelve of seventeen
assertions passed anyway. Only the three that went on to USE the card
noticed. See `docs/positional-combat-design.md` §5.

### Wave 70 — churning the hand (4 cards), 2026-09-19

Library **745 → 749**. Deal with the Devil, Lupine Assault, Specialization,
Servitor of Irad. Write-up: `docs/hand-churn-design.md`.

Four cards whose whole effect is on HANDS: one throws its own away, one throws
everybody's away, one sells a duplicate, one draws off another Methuselah's
Gehenna card. One new op (`drawUpToHandSize`), one new deferral
(`delayedReplace: "afterResolve"`), one new hook (`onGehennaPlayed`).

**What it found: `oncePerGameByName` was honoured by ONE card type.** The flag
has existed since wave 61 and was checked inside the political-action
compiler's own enumerator — so a MASTER carrying it could be played twice,
silently. It now lives in the engine's single hand-play enumerator, which
every type flows through. **When you add a flag to a FAMILY, check which
compiler reads it**: fourth instance of a flag living in one type's compiler
when it meant every type.

**And `afterAction` is not a deferral for a master.** That branch needs an
action frame; a master has none, so the chain fell through to the immediate
draw — the exact thing Deal with the Devil's printed clause exists to prevent.
A card type without the frame a deferral names gets no deferral at all.
"Replacement" also had to mean "bring the hand back to SIZE" rather than "draw
one", or the new hand ended one card over size.

**Two self-inflicted lessons, both already in CLAUDE.md.**
`addLocationAbilities` early-returns unless one of its gate fields is present,
and two new fields were added without being added to that gate (one in wave 69
too) — the ability enumerates nothing and the hook is never installed, with
nothing in a stack trace. And several patches were applied with shell
string-replacement: **a replace whose anchor has drifted is a silent no-op**,
which is why the rule says to edit source with the file-editing tools.

### Wave 69 — preying on a vampire in torpor (4 cards), 2026-09-19

Library **741 → 745**. Cloak of Blood, Stealing Years, Crematorium,
Corruption's Purge. Write-up: `docs/torpor-prey-design.md`.

Diablerie as an ACTION CARD for the first time (the engine's `diablerize:`
built-in was the only route), plus a location that burns a bloodless torpid
vampire and a referendum that creates them.

**What it found: a frame pushed from inside action resolution is thrown
away.** Calling `commitDiablerie` during a card's resolution silently lost
the BLOOD HUNT — step 5 pushes a referendum, and the action's own `pop()`
discarded it. The diablerie happened, the victim burned, and the hunt the
rules attach to every diablerie never occurred, with nothing thrown. Now
queued on the action frame and flushed in `finishAction`, beside
`queuedCombats`, whose comment says the same thing. That is the THIRD
mechanism in the engine that needs this rule (`deferChoices` is the second).

**And a zero-vote skip ate a vote rider.** The vote enumerator's
`if (votes <= 0) continue;` skipped every titleless vampire before the
per-vampire bonuses were read — correct while every bonus modified an
existing voice, wrong the moment a card GIVES one. Both new cards hand votes
to vampires with no title, and neither worked until the rider was summed
INTO the total. Wave 61's early-return lesson, in a different enumerator.

**A choice KEY is a global namespace:** the card's "gain a Discipline the
victim had" question was raised under `diablerieDiscipline`, which is the
ENGINE's key for step 4, so the answer went to the engine and the card's
question was never asked.

Also recorded: `attachSelf`'s statics are the EFFECT's, not the permanent
block's — Stealing Years' capacity rise in `permanent.statics` attached a
card that did nothing.

### Wave 68 — moving blood and gear (3 cards), 2026-09-18

Library **738 → 741**. Communal Haven: Cathedral, The Spawning Pool, Blood
Trade. Write-up: `docs/blood-and-gear-design.md`.

Blood had only ever moved from the bank to a vampire or out of one as a cost.
These three move it SIDEWAYS — between two of your own, onto a card, and
across the table — and the Cathedral moves EQUIPMENT the same way, on the same
one lock. One new event (`EquipmentMoved`, which keeps the entry so counters
and lock state travel with it), one new spec field, and a bar on a printed
KEYWORD.

Three cards rather than four: the family's other members are inert here
(Giovanni is not a V5 clan, so Powerbase: Cape Verde and Glass Walker Pact
name nobody), and The Status Perfectus needs a one-sided "cannot use any
strikes" that the combat kernel does not have — named in the write-up for a
later wave rather than half-built.

**What it found: nothing broken, and three fixture truths** — each a lesson
already in CLAUDE.md, aimed somewhere new:

- **The unlock phase cannot be set by hand.** The sweep runs as a turn BEGINS
  and only then opens the window, so a fixture that assigns `tf.phase =
  "unlock"` is asked for a MASTER-phase decision. Walk from the previous
  seat's discard phase, as wave 66's tests do.
- **A bleed goes to the actor's PREY**, so "a bleed against you" needs your
  PREDATOR to act — the first draft had the wrong seat bleeding and saw no
  option, with the card's gate perfectly correct.
- **A combat does not reach round two by itself** (p. 32): a clause in the
  second round is reachable only when somebody paid for a press. That is the
  Spawning Pool's real cost of entry, not a test artefact.

Also recorded: the Pool's unpreventable damage goes through
`applyEnvironmentalDamage`, which is documented as damage OUTSIDE combat. What
the card needs is its two guarantees — no prevention window, no strike source
— and no other op gives them.

### Wave 67 — the lock as a price (4 cards), 2026-09-18

Library **734 → 738**. Elysium: Sforzesco Castle, Elysium: The Arboretum,
Powerbase: Savannah, Atonement. Write-up: `docs/lock-as-price-design.md`.

Blocking costs a lock (p. 25); ending a combat from outside costs a card's
lock. These four move that price onto a card, onto ANOTHER card, or off the
table. Half the wave was already built (`combatEndGrant.sect` is the
Arboretum verbatim), and the two new statics are an exemption and a
substitution at the one place a blocker's lock is emitted.

**What it found: a failed block attempt could be repeated for ever.** The
dealt-game test walked 20,000 steps of `block → fail → block → fail`,
because nothing was consumed: the engine's own comment said "a failed
attempt does not lock the blocker … the same Methuselah may attempt again",
and with stealth persisting for the whole action a second attempt by the
same minion faces identical numbers. The failed blocker now goes into
`cannotBlock` — the bookkeeping the `forceFail` path beside it already did.
**Recorded reading, for the owner** (`lock-as-price-design.md` §5): the
alternative is that one minion may re-attempt within an action, which only
matters if their intercept rose in between.

**And `undefined === undefined`.** Wave 66's `clanDoesNotUnlock` compared
straight against the minion's clan, so a card without the field and a minion
without a clan matched — `unlockSuppressed` returned true for every ally and
clanless vampire, and the game stalled. **An equality between two optionals
is a claim that both are set.** Both bugs surfaced in the same run of the
same test, which is worth remembering: the dealt game builds its decks by
NAME ORDER over the whole supported pool, so every wave reshuffles it.

Also, for the second wave running, `supported.test.ts` caught a printed COST
the spec had as 0 (Atonement costs 2 blood). Read the cost off the raw
snapshot, not off the card's sentence.

### Wave 66 — paying blood to unlock (4 cards), 2026-09-18

Library **730 → 734**. Detection, Children of Osiris, Firebrand, Eternal
Vigilance. Write-up: `docs/pay-to-unlock-design.md`.

Unlocking is free (p. 17). These four put a price on it or sell it back, in
four different windows — the controller's unlock phase (twice: one bearer,
one clan across the whole table), their minion phase (for somebody else's
vampire), and mid-action to block into. One new spec field
(`permanent.payToUnlock`) pays for all four, and the two "does not unlock as
normal" halves went into `unlockSuppressed`, which already carried three
forms of that clause.

**What it found: nothing broken in the engine** — the first wave in a while
where the cards fell out of existing machinery plus one primitive. Two
things worth recording anyway:

- **Whose offer it is.** Three of the four sit on a vampire their own
  controller does not control (Detection is a hate card; Children of Osiris
  taxes every Ministry vampire at the table), so the buy-back belongs to the
  BEARER's controller and is enumerated for `ctx.seat` before the controller
  gate, with `abilityAnySeat`. **Which seat an ability belongs to is a
  per-card question** — sixth instance.
- **`supported.test.ts` earned its keep.** Eternal Vigilance prints a 1
  blood cost on the ACTION, and the first draft had 0 there while correctly
  implementing the 1 blood its ABILITY asks for later. Two prices on one
  card, and the obvious one is the one a reader skips.

Also: Eternal Vigilance's `andBlock` goes through `unlockAndAttemptBlock`
rather than emitting the unlock itself, so wave 65's Burden the Mind
surcharge charges it correctly — two consecutive waves meeting through the
funnel the first one taxed.

### Wave 65 — taxing and barring a block (4 cards), 2026-09-18

Library **726 → 730**. Aching Beauty, Artistically Inept, Kaymakli Barrier,
Burden the Mind. Write-up: `docs/block-taxes-design.md`.

The persistent side of the block-restriction family: cards that sit on a
minion and change what blocking costs or whether it is possible.

**Half the wave was already built.** Aching Beauty is `blockedPoolToll`
(written for Terrifying Visage, which prints the same sentence) and
Artistically Inept is `cannotBeBlockedBy.clans` (written for Cloak of the
Abalone). Two cards, zero new machinery, found by looking before designing
— **a NON-deferral is also a claim about the code**, and the cheap half of
a wave is usually a field that exists under another card's name. Their
tests still earn their place on the negative space: Aching Beauty charges
nothing when the bleed goes UNBLOCKED, which is what separates it from the
block tax.

The two new statics each went in beside an existing sibling rather than
somewhere new: `cannotBlockUndirected` is the third member of the
cannot-block family (unconditional, by actor kind, by what the action is
aimed at) and `directedActionBloodTax` sits next to the torpor tax and
copies its guards. **Burden the Mind's surcharge is one private helper both
unlock-to-react ops call** — the `onAnyUnlock` lesson applied before it bit,
rather than after.

**What the tests found, about tests:** an option id is
`play:<Name>:<mode>:<actor>:<target>:<cardId>`, so a substring probe for
`:M:` answers about the ACTOR segment as readily as the target. The first
draft of the Kaymakli test "failed" against correct code; it now asserts
the whole option list. Same family as the guard-clause lesson: a probe that
can match the wrong thing is a test that can lie in both directions.

### Wave 64 — the uncontrolled region (4 cards), 2026-09-18

Library **722 → 726**. Gather, Heartblood of the Clan, Social Ladder, Tomb
of Rameses III. Write-up: `docs/uncontrolled-graduation-design.md`.

Wave 63 made the influence phase's currency a thing cards touch; this wave
touches the REGION it feeds. Nothing had ever moved a vampire OUT of the
uncontrolled region except the phase's own `inf:out`, so the move is now
one helper — the pool tax and the counters-become-blood cap are rules of
the MOVE, not of the phase. Two new hooks:
`onTransferToUncontrolled` (per transfer) and `onInfluencePhaseEnd` (the
fifth phase hook, and the second that fires as a phase closes).

**What it found: the granted-action recogniser was a regex spelling the
verbs.** `vulnerableTo` writes an option id
`act:<Name>:<cardId>:<verb>:<actor>`, and the merged granted-action
provider decides who owns a chosen id with
`/:(burn|steal|shuffle|strip|raid|vote):/` — three thousand lines away.
Heartblood of the Clan's friendly outcome writes `feed`, so its action
**enumerated perfectly and threw the moment it was used**. The verb now
comes from one function and the recogniser's list is derived from it.
**A VOCABULARY KEPT IN A REGEX IS A LIST NOBODY GREPS**, verbatim, and the
second half-right bug in three waves.

**And, in this wave's own code: `ops.emit` applies immediately.** Social
Ladder moves all of a vampire's blood to an uncontrolled vampire with two
events, and the first draft read `bearer.blood` for both — so the
destination got 0. **An amount that appears twice is read once, into a
local.** The test caught it only because it asserted the DESTINATION's
counters rather than just that the bearer was gone.

### Wave 63 — transfers as a currency (4 cards), 2026-09-17

Library **718 → 722**. Ennoia's Theater, King's Rising, Whispers of the
Nictuku, Inconnu Tutelage. Write-up:
`docs/transfer-currency-design.md`.

The influence phase's counter, which until now only ever went DOWN and only
for its own controller. Four relationships to it: gained for a lock,
banned for the seat that played the card, and spent — by ANY Methuselah,
out of their own pocket — to burn a card or to find one.

**What it found: a master that pays out AND stays on the table could not
exist.** `compileMasterCard`'s resolve put the card in play and returned
before the effects loop, so a one-shot clause written beside a `permanent`
block was silently dropped: King's Rising gained no pool at all. The pool
payouts now run first, which is also the order the card's own condition
needs ("if you have 5 **or fewer** pool" is a question about the pool
before its own gain). Same shape as wave 62's `onEnterPlay` finding — an
early `return` on a path that looked complete.

**And a ban is narrower than it reads.** "You cannot use transfers to move
counters to or from your uncontrolled minions" bars two of the four things
the phase offers: the crypt draw spends transfers but moves no counter onto
a minion, and influencing a full vampire out is free (p. 36). Both legal
cases are pinned, because "no transfers at all" passes a test that only
checks the two it does bar.

**Recorded reading, for the owner:** Whispers of the Nictuku says every
Nosferatu "burns 1 additional blood to unlock". A vampire with no blood is
treated as unable to pay and **does not unlock** (p. 17's "does not unlock
as normal" family, and the `spendUnlockSink` precedent). The alternative —
skip the cost, unlock free — would make the card do nothing to a starving
Nosferatu. One line to change if the owner reads it the other way.

### Wave 62 — the stores you play out of (2 cards), 2026-09-17

Library **716 → 718**. Gift of Proteus, Storage Annex. Write-up:
`docs/store-plays-design.md`.

Two cards, not three to six, because **the family is mostly inert in a
V5-only pool**: of the eight legacy cards that print a face-down store,
Mokolé Blood filters on Serpentis (no card and no vampire in the pool has
it), Blessing of the Beast on Ahrimane, Père Lachaise on a burnt vampire
in the ash heap (deliberately unmodelled), and Research's "research area"
is read by nothing. Two more (Light Intensifying Goggles, Inceptor) are
real cards that need mechanics of their own and are named in the write-up
for a later wave.

**What it found: `onEnterPlay` has never fired for a card that puts
ITSELF in play on a successful action.** `putsInPlayOnSuccess` and
`attachOnSuccess` both emit `PermanentEnteredPlay` by hand and return, so
neither goes through `notifyEnterPlay` — which is documented as firing
"from both entry paths". Every Fee Stake, every Praxis Seizure, Heart of
the City, Preternatural Strength and Tier of Souls arrived without their
own arrival hook; it cost nothing only because none of them had an
arrival clause to run. Third instance of this exact omission (the ally
path had it, the token-vampire path is right), and the tell is the same
every time: **the path emits the entry event itself instead of going
through the shared helper.**

**And "as if from your hand" was two routes, one of them half right.**
The store's own `ability:<store>:…:play:` route offered stored cards only
in `turn.minion` and could only bring a PERMANENT into play. The Erciyes
Fragments takes any library card out of its prey's ash heap, so a stored
combat card was unplayable — the card was partial and no test could have
seen it. Fleshforge Chamber's ghoul, meanwhile, arrived with no employ
ACTION at all, because the helper it borrowed reasons — correctly, about
the Piper family it was written for — that "there is no action to block in
this family". Now there is one route: the ordinary hand-play enumerator,
with the pile swapped. **A new call beside an existing one should copy its
GUARDS before its shape.**

Also: the only thing the pile changes is the REPLACEMENT DRAW, and the
guard goes around the whole delayed-replacement chain rather than into
each branch — every branch there answers "when is it replaced", and the
answer for a card that was never in hand is "never".

### Wave 61 — table-wide pool swings (4 cards), 2026-09-17

Library **712 → 716**. Treaty of Tyre Enforced, Political Stranglehold,
Can't Take it with You, Mark of the Damned. Write-up:
`docs/table-pool-swings-design.md`.

Four referendums that bill or pay EVERY Methuselah at once, counted from
something they control. `refPerMinion` already carried two of them behind
a filter; the other two count things that are not minions, which is the
new sibling primitive `refPerSeatCards`.

**What it found: `if (hits.length === 0) continue;`.** `refPerMinion`
skipped any seat whose tally was zero — correct for every card it had ever
carried, and wrong the moment one prints a FLAT term. Treaty of Tyre
Enforced is "each Methuselah burns **X+1** pool, where X is the number of
Assamites he or she controls", and the whole point of the card is the
Methuselah with none paying 1 anyway. The guard would have billed only the
seats that deserved it, and read as sensible behaviour in a log. **An
early return meaning "nothing to do" stops being true the day the effect
gains a term that does not depend on the count** — the tell is a constant
in the card's sentence.

**And the tally reads ENTRIES, not `seat.permanents`.** "Each equipment,
location or retainer card he or she controls": equipment and retainers
live on MINIONS and only locations sit in the seat's own area, so a count
off `seat.permanents` returns a smaller number that looks correct. The
`allEntries` lesson in a tally rather than a hook.

Also: `oncePerGameByName` ("only one can be played or called in a game")
is a QUERY over the event log rather than a latch — nothing to reset,
nothing to serialize, and no gap between "played" and "called". And the
clan trap for the second wave running: the card prints "Assamite", the
registry says Banu Haqim.

### Wave 60 — the clan Justicars (6 cards), 2026-09-17

Library **706 → 712**. Banu Haqim, Brujah, Lasombra, Nosferatu, Tremere
and Ventrue Justicar. Write-up: `docs/justicars-design.md`.

The Praxis Seizure treatment on a family that already had its helper:
`titleGrant()` has carried the whole shape since wave 13 and two Justicars
were using it, so the wave is a table that builds **both** the specs and
the handlers — the list that cannot drift from its sibling.

**What it found: the two Justicars already in the pool were shipped
without `unique`.** "The UNIQUE Camarilla title of Malkavian Justicar" is
a claim on the CARD as well as the title, and the card-control contest
(p. 17) gates on `registry[name].isUnique`. This is **wave 13's Praxis
Seizure lesson verbatim, in the card family immediately next to it** — the
fix went into `praxisSeizure()` and the Justicars beside it went without.
The third time a fix has landed in one place while its sibling went
unvisited, and the first time in a card FACTORY rather than an option
enumerator.

What hid it: the TITLE contest was already right. `titleContestKey` keys
`justicar` on the vampire's clan and always has, so two Brujah Justicars
would contest their titles while their cards did not. **Half-right is the
worst state for this kind of bug**, because the obvious test passes.

**And one card held back as inert:** Gangrel Justicar prints "choose a
ready CAMARILLA Gangrel" and every Gangrel in the V5 crypt is Anarch — 14
of 14. Built, it would pass every test and never do anything (§0, the
Tradition Upheld shape). It costs nothing the day a Camarilla Gangrel
group opens.

The Justicars also had **no scenario test at all** before this wave; the
two in the pool were covered only by being in the fuzz decks.

### Wave 59 — feeding from the blood bank (4 cards), 2026-09-17

Library **702 → 706**. Blood Feast, Patshiv, Esbat, Khabar: Loyalty.
Write-up: `docs/blood-bank-actions-design.md`.

Four actions whose whole effect is blood arriving from the BANK, differing
only in who gets fed. Two new primitives (`bankBloodSweep`,
`bankBloodSplit`) over **one shared filter helper**, because the sweep and
the split ask the same question and differ only in whether anybody chooses
the answer.

**What it found: an option offered to a minion that cannot satisfy the
card's own condition.** Esbat feeds "unlocked Sabbat vampires", and
options are enumerated BEFORE the actor locks at announcement (p. 25) — so
the acting vampire was offered as a recipient of its own card, and would
have been locked and unqualified by the time the blood moved. The engine
already knew this: `actionStun`'s enumerator carries the reasoning in
full, written down as a fact about stunning rather than as a fact about
**any filter that says "unlocked"**. The sweep half was never wrong,
because it re-derives at resolution. **A filter reading a state the
ANNOUNCEMENT changes must be evaluated twice, and the two evaluations do
not agree.**

The split's apply now re-derives its recipients at resolution too, instead
of trusting ids chosen at announcement.

**And the clan trap, live.** Khabar: Loyalty prints "a younger
**Assamite**"; the registry says **Banu Haqim**. Spelled from the card
text it compiles, typechecks, matches nothing and offers the card to
nobody. Both icon-bearing cards in the wave also took `requiresClan`
(p. 10).

`ownOnly` is the field that exists to be left OFF: Blood Feast says "you
control", Patshiv and Esbat name no controller and feed the whole table.
A "yours" default would have passed every single-seat test, so the tests
seat a Ravnos and a Sabbat vampire at another Methuselah's table.

### Wave 58 — the Powerbases that bank blood (5 cards), 2026-09-16

Library **697 → 702**. Powerbase: Barranquilla, Chicago, Mexico City, New
York and Washington, D.C. Write-up:
`docs/blood-banking-locations-design.md`.

Five unique locations that are one shape said five ways: blood sits on the
card, the controller draws it down, and a minion of another Methuselah can
take the whole pile as a Ⓓ action. One new spec block
(`permanent.bloodStore`) pays for all five; the dials that differ — which
window, how much, who may raid, whether an empty card burns — are what
makes the negative-space assertions worth writing.

**What it found: a FOURTH list of the same verbs, written as a regex.**
Adding a `vulnerableTo` outcome means teaching three sites in
`vulnerableGrant` that sit together and read as a set — the option-id verb
segment, the `grantedEffect.key`, and `resolveGrantedAction`. It also
means teaching a fourth, three thousand lines away:
`owns: (id) => /:(burn|steal|shuffle|strip|vote):/.test(id)`, the
dispatch predicate on the composed granted-action handler. Miss it and the
card compiles, typechecks, enumerates its option, and is offered to
exactly the right minions with exactly the right stealth — then **throws
when anyone takes it**. "One question asked in two places will drift",
with the second place spelled as a regex, which is why grepping the
outcome names does not find it.

**And one rule where two knobs were asking to be built.** "Burn this card
if it has no blood" (Mexico City, Barranquilla) and "burn this card when
the last blood counter on it is REMOVED" (New York) read like two rules,
and the difference matters: New York enters play EMPTY by design. One rule
covers both — the check runs after every change and never at put-in-play —
so there is no second field to set the wrong way round.

Also new: `stealthFor[].titled`, and the master put-in-play path finally
passing the `counters` argument `putPermanentInPlay` has always taken.
`start.capacityOfReady` takes the largest eligible vampire rather than
raising a choice frame, and the spec comment records **why that is correct
rather than convenient** (this card's counter-play burns it instead of
taking the blood, so more counters is never worse) — because the next card
of the shape may not have that property.

### Wave 57 — the Edge as a currency (4 cards), 2026-09-16

Library **693 → 697**. Esteem, Leverage, Instability, Regaining the Upper
Hand. Write-up: `docs/the-edge-design.md`.

`state.edge` has been in the kernel since the beginning and **nothing in
the pool touched it** except the turn's optional 1 pool and Kalinda's
`unlockForEdge`. These four are the first cards whose subject it is, and
they take four different positions on it across four card types: one
gains it, one spends it, one is gated on where it sits, one moves it by
vote.

**No engine defect** — the third wave running. What the cards found was
the shape of two things:

**An action reaches a seat TWO WAYS.** "Directed at the Methuselah with
the Edge" has to read `af.target` (a bleed names the seat) *and* the
controller of `af.targetMinion` (a rush names one of its minions). A card
reading only the first would have been offered on bleeds and silently
never on rushes — the `meetsRequirements` family in a new place.

**And a test whose positive case was impossible.** Esteem's obvious
scenario is a bleed, and on a bleed it can almost never fire: p. 21 gives
the Edge to a bleeder of 1+, so by the after-resolution window the target
no longer holds it. The first draft asserted three absences and would have
passed with the card unimplemented. **When every case in a test is a
negative, the test is telling you about the fixture, not the card.**

Also: `takeEdge` / `burnEdge` ops, `ActionFrame.edgeBurnedInsteadOfTaken`
(Leverage's rider is a REDIRECTION, not a suppression — the token still
moves, to the middle of the table), `spec.requiresEdge`,
`spec.oncePerTurnByName` with `TurnFrame.oncePerTurnCards` (the printed
line scopes it to the TURN, not the seat), and `refGiveEdge` riding the
`seats` term `refChooseSeatsBurn` already built.

### Wave 56 — the cancel half of the basic combat cards (3 cards), 2026-09-16

Library **690 → 693**. Backstep, Disengage, Groundfighting. Write-up:
`docs/cancel-in-combat-design.md`.

The "do not replace until after combat" cards wave 20 deferred by name,
each of which adds a second clause to a plain maneuver or press — and for
two of them that clause is a CANCEL.

**It found nothing broken**, the second such wave in a row, and the first
time in this run that a DEFERRAL turned out to be accurate: wave 20 named
the blocker (a second clause per card) and named the shared piece already
built (`delayedReplace: "afterCombat"`), and both claims held sixteen
waves later. What made it survive is that it named a **mechanism** rather
than a feeling.

**One near-miss, caught by a ruling rather than by the code.**
"Restricts this anarch's choice of strikes" is stamped centrally onto the
play frame as `restrictsStrikeChoice`, joining `isStrike` and `keywords`.
As a BOOLEAN it reads correctly, compiles and typechecks — and is wrong
for an unarmed anarch, because *"can cancel cards preventing the use of
equipment IF THE TARGET HAS A WEAPON"* [LSJ 20050221]. It is a named value
(`"strikes" | "equipment"`), since the two bars are cancellable under
different conditions.

Also: `cancelCombatCard` gains `bloodCost` (a gate on the OPTION — *"the
card cannot be played if the minion cannot afford to burn the blood"*
[ANK 20210226]), `keywords`, `restrictsStrikeChoice` and `costIsStillPaid`
— the refund being the CARD's printed clause, not the cancel's, so
Disengage refunds and Groundfighting does not. New
`pressToStrikerIfDamaged` with `cf.pressIfDamaged`: the only credit in the
pool handed to the OPPONENT.

### Wave 55 — armed mid-combat (3 cards), 2026-09-16

Library **687 → 690**. Concealed Weapon, Zip Gun, Molotov Cocktail.
Write-up: `docs/armed-mid-combat-design.md`.

Three combat cards that each end with a weapon on the table that was not
there a moment ago — one pulled out of your HAND, and two where the card
itself becomes the weapon (one that stays, one that does not).

**It found a weapon's abilities welded to the EQUIPMENT card type.**
`spec.weapon` — the strike, the maneuver, the sniper's long range, the
keyword cancel, the unlock-on-kill rider — was compiled inside
`compileEquipment`, and nothing about it is particular to equipment: what
a weapon does is a question about the ENTRY IN PLAY. Weighted Walking
Stick's own doc comment had been recording the symptom since wave 8 —
*"the weapon strike … which no other card shape provides"* — which is a
description of where a function happened to sit, written down as though it
were a fact about the game. It is `addWeaponAbilities(spec, handler)` now,
called by both compilers, composing rather than assigning.

Also: `weapon.selfDamageOnStrike` (Zip Gun's bearer damage, latched AFTER
`resolves()` and not off `cf.gunUses`, which counts at declaration
[LSJ 20100310]), `weapon.burnAtEndOfCombat`, `weapon.notUsableAttachRound`
with a new `PermanentInPlay.attachedRound` (the CARD's age, which nothing
could answer — `cf.round` and `notFirstRound` both ask about the COMBAT),
`strikeAttachSelfWeapon`, a `"noAmmo"` tag read by wave 53's
`ammoTargetGun`, and `CardHandler.weaponProfile` for the three printed
limits Concealed Weapon reads off a card still in a hand.

### Wave 54 — the ash heap as a resource (4 cards), 2026-09-15

Library **683 → 687**. Redeem the Lost Soul, Waste Management Operation,
Maabara, The Erciyes Fragments. Write-up:
`docs/ash-heap-resource-design.md`.

The ash heap has existed since 2026-09-01 and every card that touched it
PUT things there. These four take things out, or spend what is in it —
including the first card that reaches into a PREY's heap.

**It found a zone that recorded only what its current readers needed.**
An ash-heap entry was `{id, name, crypt?}` — right for every card that
had ever read it, since the only questions were "how many" and "is it a
library card". Redeem the Lost Soul is the first card to ask a **burnt
vampire a question about itself** ("half of the capacity of that
vampire"), and the answer was not there. The registry lookup that looks
like the fix is wrong twice: a TOKEN vampire has no registry entry, and
capacity is DERIVED, so a vampire carrying a capacity master was bigger
than its printed card. The entry now records `capacity` as it burns.

Also: `storeCard` gains `from: "ashHeap"` with a `fromSeat` (the
Fragments reach into the prey's heap — the first stored card whose source
pile is not the holder's own), `store.addFromAshHeap`,
`store.toLibraryInMasterPhase`, and `permanent.ashToLibrary` for the one
card with no store in between.

### Wave 53 — before-range attachments (3 cards), 2026-09-15

Library **680 → 683**. Focus the Blood, Nosferatu Putrescence, Magazine.
Write-up: `docs/before-range-attachments-design.md`.

Three combat cards played before range that do nothing on resolution and
LAND somewhere to be cashed in later — on the vampire with its own blood
on it, on either combatant whoever controls them, and on a GUN holding an
ammo card.

**It found the four ammo rules were not in one place after all.** Their
enumerator's own comment said *"ONE PLACE FOR THE FOUR RULES EVERY AMMO
CARD PRINTS"* — true only while every caller came from a HAND, because
they were steps in a loop over hand cards rather than a question anyone
could ask. Magazine reaches that window holding an ammo card that was
never in a hand. They are now `ammoTargetGun(cf, side, minion,
minGunUses)` and both callers ask it; Glaser's load-time gate moved onto
`AmmoLoad`, since a gate both paths must see belongs on the load.

**And that `usable` exists on the spec AND on the mode**, with the
outside-combat gate reading the MODE's. Nosferatu Putrescence with it at
spec level compiled, typechecked and was offered to nobody — the "offers
the card to nobody, silently" failure, from a field that was real and in
the wrong real place.

### Wave 52 — referendums that become a table rule (3 cards), 2026-09-14

Library **677 → 680**. Beyond Reproach, Camarilla Threat, Masquerade
Enforcement. Write-up: `docs/table-referendums-design.md`.

Three political actions whose success leaves a card in play that changes
a rule for the whole table until somebody calls another referendum to
burn it. The shell (`refPutInPlay` + `vulnerableTo via politicalAction`)
already existed, so each card is one rule: an aura that bars primogen
from political actions and docks their vote, a pool tax on the discard
phase action, and the influence phase's first price.

**It found a test that passed by doing nothing.** The Masquerade
Enforcement test read `uncontrolled[0]` and bailed out if it found
nothing — and `threeSeatGame`'s uncontrolled region is EMPTY, so it was
green from the first run without asserting anything. **A guard clause in
a test is a silent skip.**

**And that `auraBlocksHunt` had drifted from `auraBonus` by two
filters** — it read only the singular `p.aura`, ignoring the additive
`auras` list, and knew nothing of `titledOnly`. Found by writing its
sibling, which is now the same helper with a key argument rather than a
copy beside it. The political bar also had to go into all THREE political
enumerators, the `meetsRequirements` failure for the fifth time.

### Wave 51 — Fee Stake (6 cards), 2026-09-14

Library **671 → 677**. Fee Stake: Boston, Corte, Los Angeles, New York,
Perth, Seattle. Write-up: `docs/fee-stake-design.md`.

The Anarch title, and the first title in the pool taken by an ORDINARY
ACTION rather than won by a referendum. One factory, the Praxis
Seizure treatment.

**It found the two put-a-card-in-play compilers had drifted**: the master
path emitted `TitleGranted` (with the city) and tagged the entry
`"title"`; the action path (`attachOnSuccess`) did neither, because no
action card in the pool had ever granted a title. Same family shape as
`onMasterPhase` and `PermanentShuffledIntoLibrary` — two paths that mean
the same thing, written at different times, that do not agree.

**And that a condition can be unanswerable in the layer you put it in.**
"+1 vote during referendums THEY CALL" looks like a `ConditionalStatic`
and would have compiled as one and silently never fired: the vote count
asks the conditional layer with no action and no referendum in hand. A
static that reads the FRAME belongs where the frame is. It is
`PermanentStatics.votesWhenCalling`, read against `rf.callingMinion`.

Also new: `voteModifiers` gains `titledOnly` / `notSect`, seeded through
`referendumSetup`, for "during that referendum, non-Anarch titles are
worth -1 vote" — a vote rider scoped to one referendum.

### Wave 50 — the Gehenna unlock-phase trio (3 cards), 2026-09-14

Library **668 → 671**. The New Inquisition, Becoming of Ennoia, Recalled
to the Founder. Write-up: `docs/gehenna-unlock-design.md`.

Three events that fire in every Methuselah's UNLOCK phase and each ask
the phase's own Methuselah a question — a shape wave 32's three did not
have. Two new `eachMethuselah` kinds (`damageReadyVampire` with
`whose`/`optional`, `burnSameClanVampire`), plus `gehennaGateOthersOnly`
("other Gehenna cards controlled by OTHER Methuselahs") and
`vulnerableTo.who.titled`.

**The "requires N other Gehenna events" gate has never been reachable by
random play** — a tally over 120 seeds found Conquest of Humanity, which
has carried it since wave 32, offered zero times. These three are proven
by scenario tests in both spaces instead.

**Two engine defects, both found by widening the fuzz to 120 seeds**, both
unrelated to the cards:

- **`preventDamage` threw when its own minion had burned itself paying
  for the card.** A 1-life ally playing a 1-blood prevention pays with
  the life that IS its blood (p. 11) — the "chosen in one window,
  resolved in another" lesson reaching the prevention path. Now a no-op.
- **`cancelPendingCard` addressed `this.top()`**, and paying for a cancel
  by discarding pushes a replacement draw that can push a frame — so the
  cancel hit a choice frame. The frame is captured before the payment
  now. An assumption a function states in its own comment is still an
  assumption.

### Wave 49 — the mummies, closed (3 cards), 2026-09-14

Library **665 → 668**. Akhenaten, Kherebutu, Tutu the Doubly Evil One —
**all six mummies are now in**. Write-up: `docs/mummies-design.md` §§4–5.

New `grantedAction` arm **`burnSelfAndBurnMinion`** (two of the three
cards): its own arm rather than a priced `burnPermanent`, because "burn
himself AND a Tremere" is one sentence with two burns — the actor goes
whether or not the target is still there. Plus
`allDamageAggravatedVsClan` (Akhenaten prints "any damage", which
`handStrikesAggravated` is the wrong half of), `unlockAtMinionPhase` and
`stealEquipment.fromTorporOnly`.

**Tutu's dodge needed nothing built**: `grantsStrikePerCombat` (Treasured
Samadji) already worked on a self-attached ally entry. The "it already
exists is a claim to CHECK" rule paying off in the cheap direction for
once.

### Wave 48 — the mummies (3 cards), 2026-09-14

Library **662 → 665**. Qetu the Evil Doer, Saatet-ta, Nephren-Ka. Write-up:
`docs/mummies-design.md`.

The family primitive — "if burned, shuffle into the owner's library" —
landed in wave 47 with Amam, so each card here cost one knob:
`endPressPerCombat` (a press credit that can ONLY end combat, the mirror
of Righteous Blade's continue-only pool), `lockGrant.grants` (one lock,
three answers — `useAbility` needed no change, it already dispatched on
`params.grant`), and `preventNonAggOnly`.

**The mirror needed a guard the original did not.** `press:continue` was
enumerated whenever any credit existed — true and correct for a
continue-only pool, true and WRONG for an end-only one, which has no
press to cancel yet. It now tests the pools that can actually buy it.

Three mummies remain (Akhenaten, Kherebutu, Tutu), each needing a
self-burning kill grant or a minion-phase self-unlock.

### Wave 47 — the deferrals, built (3 cards), 2026-09-14

Library **659 → 662**. Young Bloods, Gregory Winter, Amam the Devourer —
the three cards wave 46 deferred. Write-up:
`docs/plain-allies-design.md` §5.

Four mechanics: **several granted actions per card** (the compiler's
granted-action block is now a loop, and every option/use/resolution
carries the grant's INDEX so one grant's resolver cannot answer for
another); `ally.burnBounty` (the burner DERIVED from the live combat or
action frame); `ally.shuffleIntoLibraryOnBurn`;
`ally.opposingBurnedGainLife`; and `statics.unlockBurnLife`.

**`PermanentShuffledIntoLibrary` searched `seat.permanents` alone**, so
shuffling an ALLY home would have left its self-attached entry in play
while putting a copy of the card in the library. The `onMasterPhase`
family bug in an *apply* this time, not a hook.

### Wave 46 — plain allies II (3 cards), 2026-09-14

Library **656 → 659**. Thadius Zho, ECTU Operative, Rom Gypsy. Write-up:
`docs/plain-allies-design.md` §4.

Two new `grantedAction` arms — `burnBlood` (a Ⓓ action that burns blood
from another Methuselah's ready vampire; `steal` for the shape that keeps
it) and `burnTorporVampire` (burns a vampire in torpor; `gainLife` for the
feeders) — both reading their target at resolution with `findMinion`, so
a rescue or a burn in the action's own windows leaves nothing to do
rather than a throw.

**`permanent.lockGrant` was compiled only inside `compileMasterCard`**, so
Rom Gypsy's "Lock to give a Ravnos you control +1 stealth" — the Channel
10 sentence on an ally — compiled to nothing and was offered to nobody,
silently. The `delayedReplace` shape from wave 33 (a field wired in some
compilers and not another). Extracted to `addLockGrant(spec, handler)`,
called by the master compiler and by the shared tail for everything else.

### Wave 45 — plain allies, and the clan icon (5 cards), 2026-09-14

Library **651 → 656**. The Slashers, Outcast Mage, Rafastio Ghoul,
Procurer, Muddled Vampire Hunter. Full write-up:
`docs/plain-allies-design.md`.

**The clan icon on a minion card is a REQUIREMENT (p. 10), and 57
supported cards had none.** Dog Pack, Political Ally, War Ghoul, Zombie,
the Vozhds, Psychophagia, Night Terrors, Kali's Fang … were playable by
any minion. `requiresClan` now names the icon on all 86 icon-bearing
minion-type cards; 68 tests were fixtures with no clan and are fixed;
three negative-space fixtures that had been leaning on an icon card were
swapped for one that prints none. **Fourteen of the 57 print a clan no V5
vampire has and are now whole-but-inert until §7** — kept in the pool
pending the owner's word (§0 of the design doc lists them).

Two enumerator narrowings: `grantedAction.vampiresOnly` (Procurer:
"vampire", where Seraphina says "minion") and `rush.othersOnly` (the
Hunter: "another Methuselah", where War Ghoul reaches its own).

### Wave 44 — one each round (3 cards), 2026-09-13

Library **648 → 651**. Death Seeker, Leathery Hide, High Ground. Full
write-up: `docs/one-each-round-design.md`.

Three combat cards printing "a vampire can play only one X each round",
picked to close a RECORDED DEVIATION.

#### What the wave found

**The deviation's fix had been sitting in the same function since wave
29.** `spec.combatLimit` was enforced per combat FRAME — the gate read
`playedThisRound`/`playedThisCombat`, which hold NAMES only — so one
combatant playing a Leathery Hide barred the other from playing theirs.
`cf.playedHistory` has recorded `{name, minion, round}` since Haymaker
needed it, sits beside those lists, and the gate never looked at it. Four
lines. *"One question asked in two places will drift"* in its purest
form; the corollary recorded is **when you add a richer record, re-point
the readers of the poorer one**.

Still per frame, and now the only remainder of that deviation: the
per-MODE limit (`modeCombatLimit`, Terror Frenzy), because
`playedHistory` does not record modes.

Second, smaller: High Ground's flight test cannot be `minionHasTag`,
which reads the SELF-attached entry and so answers "what does this minion
PRINT". No vampire in the pool prints flight, so the printed-only
question would have made the clause permanently dead — whole by the
letter of §0 and inert in fact.

Also new: `cancelCombatCard` (`cancelStrikeCard` one condition wider) and
`maneuver.onlyToLong` (the mirror of `onlyToClose`). Death Seeker's six
rulings all turned out to describe behaviour the engine already had.

### Wave 43 — retainer upkeep (3 cards), 2026-09-13

Library **645 → 648**. Faithful Servant, Fortune Teller, Robert Carter.
Full write-up: `docs/retainer-upkeep-design.md`.

Three retainers whose whole text is a PHASE — the first wave outside
Equipment since 38, and picked by the window they fire in.

#### What the wave found

**The phase-hook family had a hole, and a sibling with the bug this
project has now fixed three times.**

`onMasterPhase`, `onInfluencePhase` and `onDiscardPhase` all fire as
their phase OPENS; `onMinionPhaseEnd` (wave 32) fires as one CLOSES.
There was **no opener for the minion phase** — `tf.phase = "minion"` was
a bare assignment — which is invisible until a card says "at the
beginning of his or her minion phase". New `onMinionPhase`, over
`allEntries()`.

And `onMasterPhase` was iterating `seat.permanents`, so it **did not
exist for attached cards** — every crypt ability and every retainer —
despite a doc comment saying "every card in play". Same bug as
`onAnyUnlock` (found by Fame) and `onBleedSuccess`. Corollary now
recorded: **when you add a hook to a family, re-read the siblings** —
they were written at different times and do not agree.

Fortune Teller is also the first card to reveal exactly ONE card of a
hand rather than all of it, and the first where WHICH card is a die roll;
the pick goes through `ops.randomIndex` so a replay sees the same card.

### Wave 42 — vehicles and havens (3 cards), 2026-09-13

Library **642 → 645**. Helicopter, Delivery Truck, Body Bag. Full
write-up: `docs/vehicles-and-havens-design.md`.

Three equipment cards ending "a minion may have only one \<class\>" —
the pool's first exclusivity CLASS shared across card NAMES, where
`exclusiveKey` had only ever held a card's own name (Living Manse). It
needed no code: the key is pushed onto the entry as a tag and the equip
enumerator already asks for it.

New: `PermanentStatics.locksOnEquip` (in `enterPermanent`, the shared
equip pipeline — *"directly put, not locked; equipped in any fashion,
locked"* [LSJ 20090415] [LSJ 20100119]), and two equipment abilities,
`lockToUnlockAfterSuccess` and `burnBloodToFailAction`. The store gained
`max` and `notTags` for Delivery Truck.

#### What the wave found

**One card that would have gone in wrong.** Body Bag prints *"only usable
by an anarch"*, which reads exactly like a play requirement — and is not:
*"can be equipped by a NON-ANARCH and would still count as a haven,
although the rest of his effect does not apply"* [LSJ 20030607]. The sect
gates the ABILITY, not the card. A `requiresSect` on the card would have
been invisible, because the card works correctly every time an anarch
wears it, which is every time anyone would play it. **"Only usable by" is
not "Requires".**

Otherwise nothing broken: the exclusivity key, the store and the equip
pipeline all did what the cards needed with two small parameters between
them. Three waves in, Equipment is mostly assembly.

### Wave 41 — burn the equipment (3 cards), 2026-09-13

Library **639 → 642**. Blood Tears of Kephran, Mummy's Tongue, Vial of
Elder Vitae. Full write-up: `docs/burn-the-equipment-design.md`.

Three equipment cards whose price is the CARD ITSELF — the
generalisation of the one-off `burnForIntercept` wave 40 added. Four new
arms on `equipmentAbilities`: prevent damage, gain blood, lock any
vampire in your master phase (+ `skipNextUnlock`), and +1 level of a
chosen Discipline until your next unlock phase. All burn the card FIRST.

Vial of Elder Vitae buys a trait that OUTLIVES the card paying for it, so
the boost sits on the minion as `disciplineBoostUntilUnlock` and is
cleared at one place — the controller's unlock sweep, beside
`skipNextUnlock`. An unlock phase is not a frame that ends four ways, so
the "derive, never store" lesson does not bite here.

#### What the wave found

**A missing vocabulary, and it was missing quietly.** "Any one
Discipline" is a rulebook phrase the way "every clan in the pool" is
(p. 49), and the engine had `CLANS` with a registry drift guard and
nothing equivalent for Disciplines. New `DISCIPLINES` (eleven codes), and
the guard asks the registry TWICE — a Discipline a vampire HAS and a
Discipline a library card REQUIRES are different sets that are equal
today, which is exactly when one assertion passes for the wrong reason.
The `clan-vocabulary` lesson in a new place.

Also observed: wave 40 added `burnForIntercept` as a one-off; three cards
later the same price has four payloads. `equipmentAbilities` is now a
small "burn-this-card-to-X" vocabulary, and the NEXT one that arrives
should be the refactor into `{ price, effect }` rather than a fifth
field.

### Wave 40 — discipline-granting equipment (3 cards), 2026-09-13

Library **636 → 639**. Changeling Skin Mask, Drum of Xipe Totec,
Veneficorum Artum Sanguis. Full write-up:
`docs/discipline-granting-equipment-design.md`.

Three equipment cards whose first sentence is *"the vampire with this
equipment has superior \<D\>"*. The engine had `disciplineBoost` ("+1
level of Celerity", the Discipline masters) and that is a different
thing: a boost is a STEP, so a vampire with none gets basic where these
cards say superior. New `PermanentStatics.disciplineGrant` carries the
LEVEL and applies in `disciplinesOf` as a floor, after boosts.

Second sentences: Changeling Skin Mask burns ITSELF for +2 intercept
(`interceptForBlood` with the card where the blood was, so no repeat and
no latch); the Drum's maneuver is the existing `maneuverPerCombat`;
Veneficorum is `rushGrant` with `scope: "any"` — the card offering its Ⓓ
action to every seat at the table.

#### What the wave found

A field that already existed, whose name and type FIT the new sentence
and which is wrong by exactly one level — the "empty for the wrong
reason" shape in a different costume. A card written with
`disciplineBoost` would have compiled and tested green against any
vampire that already printed the Discipline.

Second, from the Drum's ruling rather than its text: **equipment statics
that become combat credits are read once, when the combat is pushed**, so
`restrict.equipment` arriving at block resolution cannot revoke them
[RTR 20010710]. Pre-existing (Biothaumaturgic Experiment has had it since
it landed) and recorded as a known deviation beside the `.44 Magnum` one.

Also widened `rushGrant.who.clan` to a union — "Tremere **or Tremere
antitribu**", where the single string would have looked right and been
narrower than the card the day §7 opens that clan.

### Wave 39 — conditional weapons (3 cards), 2026-09-13

Library **633 → 636**. Deer Rifle, Blade of Bellona, RPG Launcher. Full
write-up: `docs/conditional-weapons-design.md`.

Three weapons whose whole text is a condition on WHEN they may be used —
the Equipment bucket's first wave since 23. Damage, range and the
once-per-combat latch already existed; what did not was a weapon with
more than one maneuver, a maneuver restricted in direction, or a strike
barred for a whole round.

`CombatFrame.usedWeaponManeuver` is ONE SLOT per side, holding the card
that maneuvered — it enforces "one weapon per side" and is what the .44
committed-strike rule reads. Rather than widen it into a count map (fewer
fields, but it would quietly change what `committedStrike` reads), the
count went beside it as `weaponManeuversUsed`, keyed by card INSTANCE for
the Chainsaw reason: two copies are two weapons [ANK 20230316].

"Only usable to get to close range" needed no new state: a maneuver flips
the range, so only a long round can reach close.

#### What the wave found

**Nothing broken** — the second wave running where the cards asked for
extensions rather than repairs, each landing one line from an existing
condition. **Writ of Acceptance is out of scope** ("is considered a
Camarilla vampire" is a sect change).

### Wave 38 — blood at the referendum (3 cards), 2026-09-13

Library **630 → 633**. Mob Rule, Rant!, Cheval de Bataille. Full
write-up: `docs/referendum-blood-design.md`.

Three polling-step modifiers that move BLOOD. The engine models voting as
SOURCES — a vampire spends its votes once and the source is then spent —
so there is nowhere to hold a bought vote: a purchase burns 1 blood and
casts immediately, which is exactly the ruling ("burn one blood at a time
and wait to see"), and is why it does not spend a vote source. The offer
lives on the referendum frame and is read by EVERY seat's enumeration:
Mob Rule hands the table a lever, and your prey can pull it harder.

§0: the pool holds 19 titled Sabbat vampires, so Cheval de Bataille is
not inert — worth checking, since "titled Sabbat" is two filters at once.

#### What the wave found

**Nothing broken — but a distinction the pool forced.** Cheval de
Bataille reads almost exactly like Alexander Silverson ("vampires burn
blood to vote against"), which the engine already has as a per-cast toll.
The ruling says otherwise: it "will cause the loss of blood to vampires
voting 'no' BEFORE it is played, as well as after" [RTR 19951110], so it
can only be a sweep at the TALLY. Building it as the toll would have
passed any test written from the card text and been wrong in every game
where it was played late — which is when it is played. **When a new card
looks like one already built, the ruling is where the difference lives,
and the difference is usually *when*, not *what*.**

**Emissary is deferred**: "any Camarilla vampire older than that anarch
can lock to cancel that anarch's votes and ballots" is a cross-seat
optional response to a vote already granted, and the referendum frame has
no such window.

### Wave 37 — the lock as currency (3 cards), 2026-09-13

Library **627 → 630**. Minor Irritation, Lost in Translation, Fillip.
Full write-up: `docs/lock-as-currency-design.md`.

Three reactions in which the lock is the price, the refund, or the thing
being worked around. Two needed almost nothing: Lost in Translation is
`redirectBleed` with `lockSelf` (and the existing enumerator already
excludes the acting seat, which is the card's "other than the acting
minion's controller"), and Fillip is a WAKE — `awake` is exactly "can
react and block without being unlocked" (p. 44). New:
`alsoByLockedMinion` ("USABLE by a locked vampire" allows both states,
where `byLockedMinion` means ONLY locked), `oncePerTurnPerVampire`, and
`noLockForBlocking`.

#### What the wave found

**An enumerator that returns an option without asking the card.** The
`afterBlockResolution` branch finds the mode, checks the blocker is locked
and can pay, and hands back the option — right while every card reaching
it was unconditional (Cats' Guidance, Forced Vigilance), wrong for the
first card with a condition, which was offered against anybody.

The near-miss is worth as much: the obvious fix — call `effectsLegal` here
too — broke Cats' Guidance at once, because those gates are written for
state A, where `unlockAndAttemptBlock` is legal and no combat has started.
**A shared helper is not automatically safe to call from a new window.**

**Coterie Tactics is deferred**: two vampires blocking as one with pooled
intercept, one then chosen as *the* blocker while the other is "still
considered to have blocked" [LSJ 20090509] — a second blocker in the
block-attempt frame, not a modifier on the first.

### Wave 36 — buying a block (3 cards), 2026-09-13

Library **624 → 627**. Legwork, Pack Tactics, Eluding the Arms of
Morpheus. Full write-up: `docs/buying-a-block-design.md`.

Three reactions that each pay a different price to get a block in, and the
first non-event wave since 30. Eluding needed NO engine work —
`unlockAndAttemptBlock` has existed since Sense the Savage Way, so the
card is four lines of data. New: `onlyIfNoIntercept` (a gate on a DERIVED
value of the reacting minion, so it cannot be a `UsabilityRule` — those
are asked once per card play, not once per candidate minion) and
`notWithThisAction`.

#### What the wave found

**A deferral note expired the moment its other half arrived.** Elder
Intervention has carried the comment *"Pack Tactics clause is moot: that
card is not in the V5 pool"* since the V5 build. Admitting Pack Tactics
made Elder Intervention PARTIAL — silently, in the same pass, with nothing
failing. `no-partial-cards.test.ts` asserts a card's own text is
implemented, and its own text was, right up to the moment the card it
names entered the pool. **A card whose text names another card by name is
a two-ended dependency**, and admitting either end has to check the other.
No other card in the pool names one this way (checked, not assumed).

### Wave 35 — events that keep a counter (3 cards), 2026-09-12

Library **621 → 624**. Dr. Marisa Fletcher CDC, FBI Special Affairs
Division, Fueled by Heart's Blood. Full write-up:
`docs/counter-clock-events-design.md`.

Three directions on one mechanism: a clock that rises to a threshold and
resets, one that rises until it burns its own card, and one that falls
from 10 — whose falling count makes the shield it grants WIDER as the
game goes on. New: `startsWithCounters` (applied in `notifyEnterPlay`,
before the card's own `onEnterPlay`), `burnCounterOnGehennaEvent` (on the
event-play site wave 33 built), and `CombatFrame.damageAfterCombat`,
drained at the engine's one `CombatEnded` site.

#### What the wave found

**Burning the acting minion from inside a successful block threw.**
`resolveBlockAttempt` pushes a combat the moment a block succeeds and
`pushCombat` reads both combatants with `getMinion`; Dr. Marisa Fletcher
removes the actor a few lines earlier, so the first time the card fired
the game died with `unknown minion`. The fix is the same shape as the
guard already sitting above it for a BLOCKER that has left play — written
as defence in depth for a case the engine could not then reach. It can
now.

**Wormwood is deferred**: its capacity cap needs `capacityOf` to read the
table, and that function takes only a minion. **Waiting Game** is out —
"becomes Camarilla" is a sect change (recorded out-of-scope).

25 events remain.

### Wave 34 — events that are one table-wide rule (3 cards), 2026-09-12

Library **618 → 621**. Port Authority, NRA PAC, Urban Jungle. Full
write-up: `docs/table-rule-events-design.md`.

The non-Gehenna events: one sentence each, no trigger and no requirement,
each changing a rule the whole table plays under. Three subsystems — the
replacement draw, the unlock sweep, the referendum tally — and each
already had the hook the card needed.

NRA PAC's two rulings pull opposite ways ("does not affect equips
performed before it arrived" [LSJ 20061218]; "regardless of whether it is
still in play" [LSJ 20080619]), which together say the card is read when
the equip SUCCEEDS and never again — so the flag lives on the minion.

#### What the wave found

**Nothing broken, and that is the finding** — the first wave in a long
run whose cards are simple rather than novel, which is evidence the
primitives have caught up with this bucket. The one engine change with
teeth is an ordering fix: "the cards are replaced BEFORE unlocking cards"
[ANK 20200129] and the deferred-draw drain ran at the END of the unlock
sweep. Nothing in the pool can tell the difference today; the ruling is
explicit, so it moved.

Two guards fired and both were right: the library audit refused three
cards named by no test or fuzz deck, and `render.test.ts` refused
**Government** and **Inconnu** as printed keywords the in-app rules never
explain.

28 events remain. **Blood Cult Awareness Network is inert by §0** — it
requires a ready imbued.

### Wave 33 — Gehenna taxes (3 cards), 2026-09-12

Library **615 → 618**. Torpid Blood, The Slow Withering, The Rising. Full
write-up: `docs/gehenna-taxes-design.md`.

The other half of the Gehenna family: events whose text is a **rule the
whole table plays under**, and whose replacement draw waits on a
**condition** rather than a phase. `delayedReplaceUntil` +
`GameState.drawWhenCondition`, released from inside `emit` — before the
event is applied, because "until your PREY is ousted" must read the
seating ring as it was when the oust happened.

Two smaller additions: a play-cost filter on the **level** of the mode
being played (`requiresSuperior`, the sibling of `requires`), with a
per-minion exemption that a diablerie sets and any Gehenna event clears;
and a pool-gain bar that DROPS the `PoolGained` event at `emit` rather
than applying it as zero — the fuzz proves pool conservation by replaying
the log, so a logged gain that never landed would break the replay.

#### What the wave found

**Narrow Minds shipped broken in wave 31.** `delayedReplace` was wired in
the combat and modifier compilers and nowhere else; Narrow Minds is an
EVENT, compiled through the master compiler, so its "do not replace until
your next unlock phase" did nothing at all. A partial card in the pool
that `no-partial-cards.test.ts` could not see — that test asserts the SPEC
is complete, not that the compiler reads every field of it. Now wired once
in `compileSpec`, where every card type passes.

31 events remain.

### Wave 32 — Gehenna: the recurring event (3 cards), 2026-09-12

Library **612 → 615**. Dragonbound, Thirst, Conquest of Humanity. Full
write-up: `docs/gehenna-events-design.md`.

The family wave 31's card type exists for: **one card, in one Methuselah's
play area, firing in EVERY Methuselah's phase, for that Methuselah**. The
three hang off three different phases — discard, the END of the minion
phase (a new hook, `onMinionPhaseEnd`, and the only one of its four
siblings that fires as a phase closes, which is what lets Thirst ask "who
did not hunt during that minion phase"), and unlock.

"Gehenna" enters as a **printed keyword that counts itself**: Conquest of
Humanity gates on 2 or more OTHER Gehenna events in play (a PLAY-TIME
check only [PIB 20121031]), and Thirst's waterline is the number of
Gehenna events in play **including itself**. §0 accordingly required the
wave to put three on the table at once, which is why it is these three.

`delayedReplace` gained `whileInPlay` — "do not replace as long as this
card is in play" names no phase, no action and no combat, so it cannot be
a counter on a seat; `GameState.drawWhenLeavesPlay` keys the wait by CARD
and `burnPermanent` releases it.

#### What the wave found

**The in-app rules screen is part of the pool's vocabulary.**
`render.test.ts` asserts every printed sub-type and keyword in the
registry is explained in the rules text, and "Gehenna" was not. Worth
noting wave 31 passed that test without an **Event** entry at all, purely
because the word "event" appears in the log section's prose — the
detector is a substring match, so it can pass for the wrong reason.

**Waves 27–31's cards were never added to the fuzz decks.** Step 5 of the
wave ritual was missed five waves running; the deck list ends at wave 26.
Wave 32's three are in. Flagged rather than fixed: adding fifteen cards
reshuffles every seeded game at once.

34 events remain.

### Wave 31 — EVENTS, the card type (3 cards), 2026-09-12

Library **609 → 612**. The Bitter and Sweet Story, Hunger Moon, Narrow
Minds. Full write-up: `docs/events-design.md`.

The Event bucket was untouched — "expect this to need machinery, not just
cards" — so this is the card type plus the three simplest events on it.
p. 37: an event is put into play with a **discard phase action**, no more
than one per phase, and **each event only once each game**.

`cardType: "event"` compiles as a master card in a different window (an
event goes into play, is controlled by whoever played it, and its text is
a static or a hook — none of that differs). The once-per-game bar is
`GameState.eventsPlayed`, by NAME and recorded at play time, so it
outlives the card. **Hand cards had never been enumerated in the discard
phase at all**, because until now nothing in hand could be played there.

Two smaller additions: a hand-size static that every seat reads against
its OWN victory points (one card, whole-table effect), and a
`PlayCostMod` that matches on what a card DOES (`redirectsBleed`) rather
than on its name, type or printed tag.

#### What the wave found

**`central-queries` was right and my shortcut was wrong.** I first mapped
the event type to no cost types, reasoning that nothing in the pool
prices an event; the test that every library card names a printed type
caught it. The cost vocabulary is the PRINTED TYPE LINE, not the set of
types somebody has written a modifier for.

37 events remain, most of them Gehenna cards gated on how many other
Gehenna events are in play.

### Wave 30 — blocked, but no combat (3 cards), 2026-09-12

Library **606 → 609**. Clan Loyalty, Blood Brother Ambush, Ghoul Escort.
Full write-up: `docs/no-combat-design.md`.

Three cards that replace the SECOND consequence of a successful block
(p. 27): the blocker locks, and the minions enter combat. These leave the
first and cancel the second. **Ghoul Escort was deferred by wave 26** and
is built here, under the owner's standing rule that a missing mechanic is
not a reason to defer a batch.

`cancelCombat` drops the combat frame and emits **`CombatCancelled`** — a
new event, distinct from `CombatEnded` so that End of Round does not run
and no after-combat rider fires. Two outcomes: the action continues (Clan
Loyalty unlocks the blocker again, [ANK 20180321]) or stays blocked
(Ghoul Escort, Blood Brother Ambush). Also new: a block bar that outlives
its action (`TurnFrame.clanBlockBars`), and a card that BECOMES a minion
mid-combat — `allyEntry` is now shared rather than the ally compiler's
alone.

#### What the wave found

**There are two effect-apply switches, not one** — one for combat cards,
one for modifiers and reactions. The new case went into the wrong one, so
Clan Loyalty played, paid its blood, emitted `CardResolved` and did
nothing. An effect kind missing from a switch is a silent no-op in the
switch that never sees it.

**An unrestricted modifier is offered in the ordinary action window**, so
Clan Loyalty was playable during the block attempt, where cancelling a
combat means nothing. Caught by the negative-space test, which was
passing through a path that never reached its clan check.

### Wave 29 — the first-strike cards (3 cards), 2026-09-12

Library **603 → 606**. Quick Jab, Forearm Block, Haymaker — the three
wave 28 deferred, built on the first-strike kernel
(`docs/first-strike-design.md`). Full write-up:
`docs/first-strike-cards-design.md`.

New: a damage CEILING on a strike ("ignore the excess", capped at
infliction so only one point ever needs preventing [LSJ 20071117]); a
round-scoped prevention pool filtered to HAND strikes, zeroed by the
first one it meets because the card says "prevent", not "can prevent"
[ANK 20200318]; a next-round first-strike grant promoted at the round
boundary; a forced normal-round strike; and `cf.playedHistory`, the only
record of WHO played WHAT in WHICH round — which is what "not usable if
this minion played a Haymaker LAST round" needs.

#### What the wave found

**`strikeHandBonus` was not forwarding its new fields.** The spec, the
engine and the card all agreed; the compiler's case passed neither
`firstStrike` nor `capDamage` through, so Quick Jab struck for full
damage and the test looked like a broken cap rather than an unread one.

**`pendingSecondStrike` was cleared one line too early** — nulled before
the call that reads it, so the second striker's blow silently vanished.
The kernel's own tests could not see it: in all of them the second
striker dies or dodges.

**The range gates were checked inside `combat.chooseStrike` only**, so a
card played in any other combat window carried an inert range clause.
Hoisted above the window switch. Second time in two waves a range gate
turned out to be in the wrong scope.

### Wave 28 — what a strike is made of (4 cards), 2026-09-12

Library **599 → 603**. Channeling the Beast, Lucky Blow, Up Yours!,
Backflip. Full write-up: `docs/strike-sources-design.md`.

Four combat cards that declare a strike, picked so the differences are
the content. Channeling the Beast and Lucky Blow print the SAME strike
and differ only in cost and "do not replace until after combat" — each is
the other's control. Backflip is a dodge with a press. Both pairs are
data on existing machinery.

Up Yours! is not: it is **the first strike whose size is printed on
somebody else's card** ("X damage, where X is the pool cost of the chosen
weapon"). `strikeWeaponCost` enumerates one option per weapon on the
opposing minion, so the choice is fixed as the card is played, and the
cost is read at resolution through `ops.registry` — which exists for
exactly this. With no weapon to name, the card is not offered at all.

#### What the wave found

No engine defect; two mistakes of mine, both about WHERE a thing belongs.

**A rider is not a second effect.** Backflip's press was first written as
a `press` effect beside `strikeDodge` in the same mode — but a mode
resolves in ONE window, and those two kinds map to different ones, so one
of them never fired. `strikeDamage` already had the answer (riders live
inside the strike primitive); `strikeDodge` gained the same field.

**The range gates are MODE rules.** `onlyAtLongRange` / `onlyAtCloseRange`
are read from `mode.usable` and are silently ignored on the spec —
`rulesHold` lists them as "checked elsewhere" and falls through. Written
at spec level, Backflip was offered at close range. A gate that does
nothing looks exactly like a gate that passes.

### Wave 27 — a second minion helps the action (3 cards), 2026-09-12

Library **596 → 599**. Suppressing Fire, Zapaderin, Stealth Ritus. Full
write-up: `docs/second-minion-modifiers-design.md`.

Three action modifiers played on the acting side by a minion that is NOT
the actor: one lends an intercept penalty to the blocker, one taxes a
whole class of would-be blockers, one has a third minion pay the price.

Two real additions. `requiresAttachedTag` — "only usable by a minion WITH
A GUN", a `meetsRequirements` clause reading equipment tags rather than a
discipline or clan. And a **yardstick that is not the acting minion**:
`ActionInterceptModified` already carried a `youngerThan` id, but it was
hard-coded to `af.acting` and only resolved when the minion handed to the
filter WAS the actor. Zapaderin measures against the Ravnos who played it,
who by the card's first sentence is not the actor.

#### What the wave found

No engine defect; two mistakes of mine, both more instructive.

**I rebuilt a primitive that already existed.** `modifyBlockerIntercept`
has been in the pool since Forced Confessional, with a better gate than
the one I wrote. It compiled only because `EFFECT_TAGS` is a total
`Record` over the effect union — an exhaustive map is what turned a
silent duplicate into a compile error. "It already exists" is a claim to
CHECK, and so is its opposite.

**A fixture that shared a card instance id.** `threeSeatGame` deals Alice
a Conditioning with id `c1`, and the fixture pushed the wave's card with
the same id — so the engine resolved the wrong card and three working
cards looked like three broken ones. The event log said so plainly
(`BleedAmountModified` from a card that modifies no bleeds); it is the
first thing to read when an effect "does not happen".

Also relearned: a modifier resolves when the impulse cycle it was played
in COMPLETES, not when its as-played window closes.

### Wave 26 — retainers bought with a price (3 cards), 2026-09-12

Library **593 → 596**. Corpse Minion, Malajit Chandramouli, Omael Kuman.
Full write-up: `docs/retainer-prices-design.md`.

Wave 22 asked what a retainer does in a fight; this one asks what one
**costs**. Three different answers: the employer's blood (Corpse Minion,
+1 intercept), the retainer's own lock (Malajit, +1 stealth), and blood
again for something that is not a bonus at all (Omael Kuman, the range).

Corpse Minion is the pool's first **repeatable** in-window price — *"may
be used any number of times during a single action"* [TOM 19960109] — so
it carries no latch, which is what makes "burn X for +X" and "burn 1 for
+1, repeatedly" the same offer rather than an approximation.

Malajit's second clause, *"if that action is blocked, burn him"*, fires at
the block-success site beside `blockedToll` and `blockedPoolToll` — the
two statics that already meant "the actor pays for having been blocked" —
and only for a LOCKED card, since locking him is how he is spent.

#### What the wave found

No engine defect; one test defect worth more than an engine one. The
first draft built the retainer entry by hand with `statics: {}`, so
Malajit's burn-when-blocked clause **was not in the fixture at all** and
the test failed against a copy of the card that had never had it. That is
"empty for the wrong reason" in its test-side form: a fixture assembled by
hand is a second, silently drifting model of the card. The helper now
takes its statics from the compiled handler.

Also worth recording: with a bare blocker, +1 stealth simply WINS, so the
action is not blocked and the burn clause is never reached. The blocker
has to be given enough intercept to succeed anyway, or the test passes
without testing anything.

**Deferred: Ghoul Escort** — "burn this retainer and unlock instead of
entering combat" replaces the block's second consequence (p. 27) rather
than pricing a bonus, and wants a choice raised before `pushCombat`.

### Wave 25 — destroyer allies (3 cards), 2026-09-12

Library **590 → 593**. The Bruisers, Arcanum Investigator, Felix "Fix"
Hessian. Full write-up: `docs/destroyer-allies-design.md`.

Three allies that print stats and one clause: a Ⓓ action that **burns a
card in play**. The action existed (`actionOnPermanent`, from Conceal and
Arson) and the grant existed (`permanent.grantedAction`, from the crypt
waves) — but none of `grantedAction`'s six arms **destroyed** anything,
so the two had never met. `burnPermanent` is a seventh arm carrying
`what` (location or equipment) and `scope` (prey / predator-or-prey /
any other Methuselah), plus a `poolCost` field, because an ally's blood
IS its life (p. 11) and Felix's pool price is not interchangeable with
one.

Scope gates the OPTION, not the resolution: announcing locks the ally and
spends its action, so a target that was never legal must not be
announceable. Never your own cards either — Felix's text is as
unqualified as Arson's, and Arson has excluded the acting seat since it
was built.

#### What the wave found

No engine change at all — three cards, three scopes, one switch case and
one field, which is the `grantedAction` shape finally paying for itself
(the previous ally wave needed a mechanism per card).

One test lesson: a hand-written pass list pinned the wrong seat order,
because the impulse cycle after an announcement does not begin at the
acting seat. The test now walks whatever the engine asks and asserts
**which seats were offered a block** — which is what Ⓓ means, and is
immune to where the cycle starts.

### Wave 24 — reactions that read the acting minion (4 cards), 2026-09-12

Library **586 → 590**. Banner of Neutrality, Keep it Simple, Nest of
Eagles, Venetian Conference. Full write-up:
`docs/acting-minion-reactions-design.md`.

`CardSpec` had eight `requires*` fields and every one asks about the
vampire **playing** the card. These four ask about the minion being played
**against** — "only usable if a Camarilla or Sabbat vampire is bleeding
you", "not usable if the acting minion is an Assamite or wraith or has
flight" — and nothing could say it. `UsabilityRule` was the near-miss: it
already carries acting-side clauses, but it is a string union, so it can
say "the acting minion is an undead ally" and can never say "…is one of
these two sects". Hence `requiresActing`, a record checked in the one
place `spec.usable` is.

Two smaller firsts: a bleed modifier whose SIZE is read off the action
(Keep it Simple, −1 per point of the actor's stealth, a snapshot that
works because the bleed amount is a fold), and a `bonus.extra` that is
**negative** — Nest of Eagles' "by 3 **instead**" is base −1 plus extra
−2, which is the whole difference between "instead" and "as well".

#### What the wave found

No engine defect — the first wave in a while without one. It found a
**shape** instead: a card's conditions were expressible either as a
parameterless `UsabilityRule` or as a `requires*` about the player, and
the acting minion had no home in either.

**"Assamite" is the pool's BANU HAQIM.** The clan filter that matched
nothing is already in the CLAUDE.md lessons; here the failure would have
been backwards and silent, because Nest of Eagles' clause is a NEGATIVE
one — the wrong name would not make the card unplayable, it would make it
playable against precisely the minions it says it cannot answer.

**Venetian Conference costs 1 blood**, which its printed text does not
say; `supported.test.ts` caught the spec disagreeing with the registry.

### Wave 23 — one-shot weapons (4 cards), 2026-09-12

Library **582 → 586**. Grenade, White Phosphorus Grenade, Smoke Grenade,
Waxen Poetica. Full write-up: `docs/one-shot-weapons-design.md`.

Four weapons that print **"Burn after use"**, and the wave is about *when*
"use" happens. `usableOnce` is spent when a strike is CHOSEN — on
purpose, because a dodged strike was still a use of the weapon. These
four burn when the strike **resolves**, and the rulings insist on the
difference from both sides: *"does not burn nor inflict damage if combat
ends before it resolves"* [LSJ 19981006], and yet the Smoke Grenade,
whose own strike IS "combat ends", *"still burns when used"*
[LSJ 20001127-2]. Both fall out of one loop in the combat-ends branch
that burns a weapon only when the combat-ends strike is its own.

The rest is three riders on `spec.weapon`: environmental self-damage at
close range (`source: null`, [LSJ 19970801] — so no dodge, prevention or
reaction that reads "damage from the opposing minion" can see it), a
strike that ends combat, and a "not usable against" gate read off the
opposing minion.

#### What the wave found

**`chooseWeaponStrike` pinned `combatEnds` to false.** The field had been
on `Strike` since the start; every weapon that existed dealt damage, so
the weapon path never passed it through.

**Blood is not evidence of aggravated damage.** Both aggravated cards
failed their first assertions: this engine sends a ready vampire to
torpor on *any* aggravated damage, so 1 point and 2 look identical
afterwards. The tests read `DamageInflicted` instead — which is also the
only way to assert the environmental packet, the thing the wave adds.

**Deferred:** Bomb (a Ⓓ action that burns a location, on top of the same
one-shot machinery) and Improvised Flamethrower (burns on *being hit* at
long range, a trigger no weapon has).

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
