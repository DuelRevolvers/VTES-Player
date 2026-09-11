# VTES Platform — Project Memory

> **Rewritten 2026-09-07.** This file had grown to 6,382 lines of
> wave-by-wave history, much of it stale — it still listed finished phases
> as upcoming and named blockers that had been built days earlier. That
> staleness cost this project more time than any bug. Nothing is lost:
> every mechanic has its own doc in `docs/` (115 of them), which is where
> the citations, readings and traps live, and the old file is archived at
> `docs/project-memory-archive-2026-09-07.md`. **This file is now only what
> is BINDING and what is TRUE.**
>
> Keep it that way. When you finish something, update the status and the
> queue here rather than appending a new narrative.

## What this is

A browser-based platform for **Vampire: The Eternal Struggle** (VTES, 5th
Edition) with **AI players that fill empty seats**. Desktop browsers only.

Non-commercial fan project under Paradox Interactive's **Dark Pack**
agreement — **never add monetization**, and keep the Dark Pack attribution
in the UI. Card data and scans come from **KRCG** (static.krcg.org,
official VEKN data, used with permission).

**Rules source of truth:** the official V5 rulebook PDF at
`..\Vampire The Eternal Struggle Fifth Edition rulebook ENG.pdf` (one
folder above the repo). Read it rather than guessing; its text layer
extracts cleanly (a ~40-line Node script using only `zlib` has done this —
no `pdf-parse` dependency needed). Verified sequencing citations are
collected in `docs/impulse-design.md` §10. **When card text contradicts the
rulebook, card text wins** (the Golden Rule, p. 16).

## Scope (locked)

- **Library** = the **V5 product line** (`config/v5-sets.json`: 7 KRCG
  sets — Fifth Edition, Anarch, Companion, Sabbat V5, New Blood I–III)
  **plus any legacy card that has been implemented.** **582 cards, all
  implemented.** A legacy library card is admitted by
  `config/supported.json` alone — there is no separate config, because
  for the library "implemented" and "may be in the pool" are the same
  question (`docs/pool-widening-design.md` §6).
- **Crypt** = the V5 sets. **217 cards, all whole.** The machinery to
  widen past them exists and is deliberately switched OFF:
  `config/crypt-groups.json` is `"groups": []`.
- **799 unique cards.** *Re-derive from `src/cards/registry.json` rather
  than trusting this line.*
- **Widening is a PIPELINE, not a switch** (`docs/pool-widening-design.md`).
  Opening a group in that config admits only vampires that are already
  whole — the builder gates on it, so the pool can never get ahead of the
  card waves. A 2026-09-08 widening to 1,680 crypt cards was rolled back
  on the owner's word because it had admitted 1,104 inert abilities; the
  gate is what stops that recurring. To widen: implement a clan's
  abilities, then open its groups, then `npm run cards:registry`.
- The legacy pool (~3,500 more cards) is out of scope for now.
  **Never widen without the owner's say-so.** `data/vtes-raw.json`
  already holds all 4,149 KRCG cards, so every widening is a config edit
  plus `npm run cards:registry` — no network fetch.
- **The crypt is cheap to ADMIT and not cheap to FINISH**, and those are
  different things. An unimplemented crypt ability is reported as inert
  rather than blocking the deck, so the registry would happily take a
  vampire whose text does nothing — which is precisely why the gate
  exists rather than being left to judgement.

---

## Architecture principles (settled — do not relitigate)

1. **Headless engine.** `src/engine/` is a pure TypeScript library: no
   DOM, no networking, no rendering. It runs in Node for tests and batch
   AI simulation.
2. **Deterministic + event-sourced.** All randomness through a seeded RNG.
   Game = initial state + command sequence. State fully serializable. This
   is what makes replays, reconnection, undo and reproducible bugs work.
3. **The impulse/window system is first-class.** VTES sequencing (impulse
   order, block-attempt states, "as played" windows, wakes) is an explicit
   state machine. The loop is: compute whose decision → compute legal
   options → ask that seat's Agent → apply → repeat. Cards register
   handlers into windows; **cards are never special-cased into the loop.**
4. **Legal-move generator.** The engine always knows every legal option at
   every decision point. The UI renders only these; AI chooses only from
   these; the multiplayer host validates client intents against these.
5. **Agent interface.** `Agent.decide(decisionPoint, legalOptions,
   playerView, masked?)`. Humans and AI implement the same interface.
   `playerView` is a masked view — the hidden-information boundary.
6. **Cards as data + primitives.** A vocabulary of parameterized effect
   primitives; most cards are data referencing primitives, with a bespoke
   tail behind the same interface.
7. **Transport seam.** The UI never touches the engine. `GameTransport` is
   `decision()` / `view()` / async `choose(id)` / `onChanged(cb)` /
   nullable `history`. `LocalTransport` serves hotseat, bots **and the
   multiplayer host**; `PeerTransport` swaps in with no UI change.

---

## Status (accurate as of 2026-09-11, platform v0.10.7)

**Phases 1–7 are COMPLETE.** Data pipeline, rules kernel, the entire V5
card pool, the play UI, AI v1 + batch simulation, PeerJS multiplayer with
lobby and room codes, and the deck importer (32 precons derived from the
KRCG snapshot, 18 of them playable as printed — the rest are New Blood
starters, half decks by design).

**The card pool is finished and WHOLE — every card in it does everything
it prints**, which `tests/cards/no-partial-cards.test.ts` asserts over
the entire registry.

- **Library 582/582 (100%)** — 444 V5 plus 138 legacy cards from twenty-two
  waves (2026-09-09/11): 14 weapons, 13 locations, 7 equipment statics,
  7 retainers and allies, 13 Praxis Seizures, 4 referendums, 6 one-shot
  masters, 7 cost-modifier masters, 4 action modifiers, 3 referendum
  reactions, 10 action cards, 13 political actions, 5 ammo, 3 aim,
  5 Discipline masters, 12 Crusades, 5 basic combat,
  4 referendum riders, 3 combat retainers.
- **Crypt 217** — 99 with an implementation, 118 printing no ability and
  needing none. Both kinds are whole; there is no third kind.
- Total with an implementation: 681/799. *Re-derive these from
  `src/cards/registry.json` rather than trusting this line.*
- `docs/partial-support.md` is the ledger of supported cards with a
  known-missing clause. **Its "needs engine work" table is empty**, there
  are no `// PARTIAL:` markers left in `cards.ts`, and the cut and blocked
  lists are empty.
- **`docs/card-status-by-set.md` is the whole picture**: every one of the
  4,149 KRCG cards, by set, as built / whole / which wave takes it. It is
  GENERATED — regenerate it in the same pass as any card wave
  (`node scripts/card-status-by-set.cjs > docs/card-status-by-set.md`)
  and never hand-edit its numbers.

**Everything plays.** `npm run play` deals a real game from real decks;
bots fill any seat; two people can play over a room code.

**Green baseline: 205 test files, 2299 tests**, with `npm run typecheck`,
`vite build` and `npm run simulate` all clean. If a fresh session sees
fewer, something regressed.

**Saved games and default bot names landed 2026-09-09 (v0.9.8)** —
`docs/saved-games-design.md`. The Profile screen now lists the games this
browser holds: named slots plus a **Last game** slot the table rewrites
at the top of every turn, loadable from there or from a `.json` file. A
save now records **which seats were bots** (`SavedGame.botSeats`), without
which a loaded private table came back with nobody driving three of its
seats. Bot seats also take their default names from the Profile screen.

**Only runtime dependency: `peerjs` ^1.5.5.**

### The queue

1. **PHASE 9 — PUBLISH.** Groundwork done and verified
   (`docs/pages-design.md`). One item left, and it needs an image editor:
   **the banner is 2160 KB of a 3.19 MB first paint (68%)**. Re-save at
   ~2200px as **WebP, not JPEG** — the alpha channel IS used (8.5% of
   pixels partially transparent, measured). Deploying is the owner's act;
   nothing in the tree publishes by itself.
2. **PHASE 8 — widen the pool beyond V5.** Plan and status:
   `docs/pool-widening-design.md`. **The CRYPT is deliberately still
   V5-only; the LIBRARY is widening, one implemented card at a time.**
   The config split, the crypt group rule, the sect/title fixes and the
   ambiguity-resolving deck importer all landed; a widening to 1,680
   crypt cards was then rolled back because it broke "No partial cards",
   and the builder now gates on wholeness so it cannot recur.
   **Widening is now downstream of card work**, and the card work is:
   - **§6 — the library, IN PROGRESS.** Three tranches, in this order:
     **T1** no discipline, **T2** only disciplines the V5 crypt already
     has, **T3** a legacy discipline. The library comes before the crypt
     because the nearest crypt cards carry legacy disciplines nothing in
     the pool yet requires. A legacy library card is admitted by
     `supported.json` alone, so implementing it and admitting it are one
     edit.
     **Waves 1–22 landed 2026-09-09/11, library 444 → 582.**
   - **§7 — the crypt abilities.** Follows the library. Clan-by-clan
     waves, each of which lets its clan's groups be opened in
     `config/crypt-groups.json`. **1,162 legacy vampires print an ability
     with no implementation**; a further **386 print none and are already
     whole** — those enter the pool the day their group opens, for free.

   **The road ahead, T1 by bucket** (re-derive with
   `scripts/card-status-by-set.cjs`; **1,068 cards left in T1**, then 229
   in T2 and 485 in T3):

   | Bucket | Left | Notes |
   |---|---:|---|
   | Master | 364 | **Almost no families** — clustering by text shape finds few groups of three or more, so masters are mostly hand-picked a few per wave. Opened in wave 7; wave 18 took the five Discipline masters the pool can use. **Nine more Discipline masters are whole-but-inert until §7** (they grant Disciplines nothing in the pool requires) and cost nothing on the day their clans open. |
   | Action | 176 | Opened in waves 11–12. |
   | Political Action | 106 | Opened in waves 13–15, 19 and 21; the richest vein — five waves, five engine gaps. Wave 19's Crusades exposed that a card-granted title never recorded its CITY; wave 21's outcome riders exposed that `postTally` could not ask WHICH WAY the vote went, and that Día de los Muertos' sect clause was written into the engine rather than onto its grant. **Deferred: Political Backlash** — "only usable when a referendum FAILS", and the after-resolution window opens only on a PASS. **Eleven more Crusades wait on §7.** |
   | Equipment | 118 | Statics opened in wave 3. |
   | Ally | 90 | |
   | Combat | 45 | Opened in waves 16 (ammo — the missing before-resolution window), 17 (aim — a payload held until the strike lands) and 20 (the basic dodge/maneuver/press cards — "do not replace until after combat", a deferral that is NOT the action's). **Target Retainer is deferred** (retargeting a strike at a retainer means addressing a permanent from the damage path); so are the remaining delayed-replacement cards, which each add a second clause. |
   | Action Modifier | 47 | Opened in wave 9. |
   | Event | 40 | **Untouched.** No event card is in the pool at all; expect this to need machinery, not just cards. |
   | Reaction | 40 | Opened in wave 10. |
   | Retainer | 25 | Opened in wave 22 (the combat retainers), which found that `lockToPrevent` priced a prevention rate as a cost, and that `grantedAction` could not be priced in the card granting it. **Several are Gargoyle- or Laibon-gated and inert by §0** until those clans are in the pool. |
   | (mixed types) | 22 | Action Modifier/Reaction and friends. |
   | Conviction | 3 | Imbued-only. **Out of scope** — no engine model. |

   **Sequence by MECHANIC, never alphabetically.** A wave is a family
   that shares a primitive, which is what makes one new primitive pay for
   four or five cards and what makes the negative-space tests meaningful.
   **Deferred, waiting on §7:** Tradition Upheld (needs a Caitiff in the
   pool).
3. **AI.** Weight-tweaking is exhausted, demonstrably
   (`docs/richer-options-design.md` §5–§8). A search agent exists, is
   guarded, and is **not better yet**; the unsolved part is the VALUE
   FUNCTION, then modelling an opponent's reply — which needs sampling
   their hidden cards and is always a guess, because deck lists are
   private.

---

## The lessons that keep paying (read these)

Distilled from ~60 card waves and several playtests. Each has bitten more
than once.

**A deferral is a claim about the code AS IT WAS.** Five cut-list rows in
eight waves named a blocker that had since been built or was cheaper than
written down (Touch of Valeren, New Carthage, Break the Bonds, Hunting the
Quarry, Spying Mission). AI v2's "prerequisite" was a state object that
already existed. **Check the tree before designing against a note.**
Reading `docs/partial-support.md` takes minutes; re-deriving it takes
hours.

**Empty for the wrong reason.** A filter that matches nothing, an option
list that is empty, a value that is zero — these look identical whether
they are correct or broken. The fuzz **structurally cannot** see a
too-permissive or too-narrow option list. Only negative-space assertions
catch it, and a negative test needs a fixture that fails for the RIGHT
reason. Seen as: a clan filter naming "Assamite" (the registry says Banu
Haqim), unenforced `meetsRequirements`, a test that passes by doing
nothing, and a measurement that reads zero because it never ran.

**A set derived from "the registry" has to name its card KIND.** While
the library was V5-only, crypt clans and library clans were the same
names, so `clan-vocabulary.test.ts` could union both and be right by
accident. The legacy library brought in twenty-two clans no vampire has
(Giovanni, Osebo, Brujah antitribu…), and a library card's clan is an
ICON, not a vampire — `CLANS` is what Consanguineous Boon offers and p. 49
says that is the clans in the POOL. Expect every registry-derived set to
need this question re-asked as the library widens.

**`meetsRequirements` has now been forgotten FOUR times**, most recently
by `permanentActionOptions` — the shared recruit-ally / employ-retainer /
put-permanent enumerator — which left every clan- and sect-gated ally and
retainer in the pool playable by any minion (Crypt's Sons, Feral Hound,
both Szlachtas). Twice now the fix went into one enumerator while a
sibling went without. **When you add an option enumerator, or fix one,
check every other one.**

**"It already exists" is a claim to CHECK, not to make.** Praxis Seizure
prints "this could lead to a contested title", and the contest was
reported as free because the engine models contests. It gates on
`registry[name].isUnique`, which the card did not set — and turning it on
uncovered that the contested path never emitted `TitleLost`, so a
contested prince kept a title granted by a card no longer in play (Regent
had the same bug). A deferral is a claim about the code as it was; so is
a NON-deferral.

**A strike is CHOSEN in one window and RESOLVED in another**, and a
combatant can leave the table in between — an ally paying a cost with the
life that IS its blood, a burn, a removal. `inflict()` read both
combatants with `getMinion` and threw. The fuzz found it on seed 1 the
moment a card that burns allies from outside combat joined the decks, and
stashing the deck change turned it green: **a green fuzz before and a red
one after is usually a latent bug being dealt in, not a new one.** Read
the fuzz failure as a report about the ENGINE first.

**A card can be WHOLE and still be inert, and the pool wants neither.**
Tradition Upheld ("choose a ready Caitiff … burn that Caitiff") was built,
tested and passing before `clan-vocabulary.test.ts` pointed out that no
vampire in the pool is Caitiff — 36 legacy ones are, none in V5. It did
everything it printed and could never do anything. §0 keeps that out for
the same reason it keeps partial cards out. **Before implementing a card
that filters on a clan, title, sect or card type, check the pool actually
contains one.** Deferred to §7; it costs nothing the day a Caitiff group
opens.

**A new call beside an existing one should copy its GUARDS before it
copies its shape.** `applyReferendumFailed` was added one line above a
call that reads the same field, and the neighbour's `rf.cardInstanceId &&`
was not a style choice: a BLOOD HUNT is a referendum with no calling card
and an empty `cardName`, which `handler()` throws on. Five test files went
red at once. The guards around a line are part of what that line means.

**A handler lookup cannot answer a question whose answer differs by mode.**
Denormalize onto the frame or the entry instead (the `isMaster`
treatment).

**One question asked in two places will drift.** `modifyVotes` /
`restrictVotes`, the two after-resolution probes, the polling enumeration
— each time a new case taught one site and not the other. Funnel through
one helper.

**A hook that iterates `seat.permanents` does not exist for attached
cards** — and every crypt ability is attached. Use `allEntries()`.

**Machinery that exists, is documented as general, and quietly does not
apply to one case.** `onAnyUnlock` missed attached cards; `onBleedSuccess`
missed them again; `onActionAnnounced` fired one step too early for its
whole life. When you add a hook, check every path that should reach it.

**A derived read must be TOTAL.** A minion can leave play at any point —
an ally's life IS its blood, so one at 1 life paying a card's cost removes
itself mid-action. Read minions with `findMinion`, never `getMinion`, in
derived code and in option enumerators. A throw there surfaces as a game
nobody can answer rather than an error somebody can act on.

**Which seat an ability belongs to is a per-card question**, and getting it
backwards offers the card to nobody, silently. Bitten five times
(`controllerOfEntry`, Disarm, Puppet Master, `rushGrant`, Faruq/Sergio).

**A parenthetical often DESCRIBES existing behaviour** rather than asking
for new behaviour ("the minion chooses a strike again", "even at close
range"). Building to it is how a re-entrancy bug gets written. Five
instances.

**A walker that takes `options[0]` plays the board.** Test walkers must
prefer `pass`, then `end`. And **a fixture that sets blood to 0 has
enabled a MANDATORY hunt** (p. 21) — seven instances of that one.

**An assertion about a total set is a hostage to every future change.**
Pin the *reason*, not the count.

**Anything scoped to a live frame is DERIVED on every read, never stored.**
A combat ends four different ways; a flag that must be cleared at all of
them will one day survive one.

**Measure before you design, and measure on more than one deck.** In the
AI work one deck told a story three others contradicted — twice. A
measuring instrument needs its own controls: a negative control (A vs A is
a dead heat) *and* a positive one (a crippled policy loses), or "no
difference" means nothing.

**A feature that cannot be discovered is indistinguishable from one that
is absent.** Reported twice by the owner about features that already
worked.

---

## Version numbering (BINDING — owner rule, 2026-09-07)

The platform carries a version number, shown in very small text at the
foot of the main menu under the copyright line, e.g. **`platform v0.9.8`**
(what it actually reads is whatever `src/version.ts` says — see below).

- **It lives in `src/version.ts`** (`PLATFORM_VERSION`), which is the
  single source of truth. `package.json` carries the same string and
  `tests/ui/version.test.ts` fails if the two drift apart.
- **BUMP IT BY 0.0.1 EVERY TIME CHANGES ARE MADE.** Every wave of work
  that lands — a card wave, a bug fix, a UI tweak — earns exactly one
  +0.0.1. This is a build counter people can quote in a bug report, not
  semver in the library sense: do not reserve the patch digit for "small"
  changes or save up several changes for one bump.
- Bump it as part of the change itself, in the same pass that edits the
  code, so a build and its number cannot disagree.
- The current version is whatever `src/version.ts` says. **Read it rather
  than trusting this line** — the example above is an example.

## No partial cards (BINDING — owner rule, 2026-09-08)

> *"We can't half-ass any card, ever. We need all cards added to this
> platform working at 100% entirely or we literally can't play the game
> correctly. Never skimp on building cards."*

A card is **in the pool** only when it does everything it prints. Not
most of it, not the common case, not "that clause is rare".

- **A vampire's printed ability counts.** A crypt card whose ability does
  nothing is a card that plays wrong every time the ability would have
  mattered, and nothing on the table shows it happening.
- **"Reported as inert" is not a substitute for implemented.** Telling a
  player the card does nothing is honest; an honest wrong card is still a
  wrong card. `inertAbilities` exists so a playtest is not misled — never
  as a licence to ship the card that way.
- **Admitting a card to the registry is a promise about it.** If its
  ability is not built, it does not come in yet. This is why the crypt
  widening is a pipeline (`config/crypt-groups.json`), not a one-off:
  cards follow the waves that implement them.
- This outranks any counting argument. "Cheap" in a design doc means
  cheap to ADMIT — see `docs/pool-widening-design.md` §0 and §7, where
  eliding that distinction let 1,104 vampires with inert abilities into
  the pool before it was rolled back.
- **It is enforced, not trusted.** `tests/cards/no-partial-cards.test.ts`
  asserts it over the whole registry, and `widenedCrypt` in
  `scripts/build-registry.mts` refuses to admit a card that fails it. Do
  not weaken either to make a widening land.

## Card registry rules

- `src/cards/registry.json` is **generated** (cards AND the 32 precon
  decks) — never hand-edit. Rebuild with `npm run cards:registry`.
- `config/supported.json` (card id → true) is hand-maintained. A card may
  be flipped to supported **only** when it has (a) an effects
  implementation and (b) a passing scenario test. The pipeline reads it,
  never writes it.
- Deck import validates against the registry and reports unsupported cards
  — never silently drops or breaks.

## Adding a card (established workflow)

1. Read the exact card text from `src/cards/registry.json` — never guess;
   check the rulebook and rulings for timing subtleties.
2. Express it as a `CardSpec` if the vocabulary covers it; extend the
   vocabulary if the pattern recurs; otherwise hand-roll a `CardHandler`
   in `cards.ts` (the bespoke tail). **Never special-case the engine
   loop.**
3. Write a deterministic scenario test in `tests/cards/`. Fixtures'
   `runTrace(engine, [[seat, optionIdPrefix], …])` drives every decision
   explicitly. **Assert the negative space too** (option NOT offered).
4. Flip the id in `config/supported.json`, run `npm run cards:registry`.
   **`implementedIds` is only for a bespoke handler with NO spec** — it
   already starts with `...cardSpecs.map(s => s.krcgId)`, so adding a
   spec-compiled card again makes a duplicate and `supported.test.ts`
   fails. **Then regenerate the status doc** (owner rule, 2026-09-09):
   `node scripts/card-status-by-set.cjs > docs/card-status-by-set.md`.
   It must be current after every wave, widening or registry rebuild;
   never hand-edit its numbers.
5. Add the card (and any discipline it needs) to the fuzz decks in
   `tests/engine/fuzz.test.ts`. **Every addition reshuffles every seeded
   game**, so a green fuzz before and a failure after usually means a
   pre-existing latent bug just got dealt in.
6. `npm run typecheck` && `npm test` green before done.

### A WAVE (what the owner means by "onto the next")

A wave is 3–6 cards that **share a mechanic**, not a letter of the
alphabet. Picking the family is most of the work: one new primitive
should pay for the whole wave, and the cards should differ in ways worth
asserting against each other.

1. **Pick the family** from the T1 bucket table above, and **check the
   pool can actually produce its targets** before building — a card that
   filters on a clan, title, sect or card type the pool does not have is
   inert, and §0 keeps inert cards out as firmly as partial ones.
2. **Read the printed text from the raw snapshot**, not from memory, and
   read the RULINGS. Three waves running, a legacy card's ruling exposed
   a missing half in a V5 card already in the pool.
3. Implement, test and admit each card by the six steps above.
4. **Bump `src/version.ts` and `package.json` by 0.0.1** in the same pass.
5. **`npm run typecheck`, `npm test`, `npx vite build`, `npm run simulate`**
   — all four, every wave.
6. **Update three files**: a wave section in
   `docs/pool-widening-design.md` §6, the counts and green baseline in
   this file, and `docs/card-status-by-set.md` (regenerated, never
   hand-edited).
7. **Report to the owner**: library / crypt / total, re-derived from
   `data/registry-report.txt`, plus what the wave found. The card counts
   are the least interesting part — **the engine defects the cards
   uncovered are the point**, and every wave since 11 has found at least
   one.

**Edit source files with the file-editing tools, never with shell string
surgery.** `node -e`, heredocs and `sed` mangle TypeScript — backticks,
`${...}` and apostrophes get eaten by the shell, and this has silently
corrupted `render.ts` and `cards.ts` more than once. Shell is fine for
JSON and for read-only queries.

### Option-id conventions (trace tests match by prefix)

- `play:<Name>:<mode|->:<minion>:<params…>:<cardInstanceId>` — hand plays
- `ability:<Name>:<cardInstanceId>:<params>` — in-play abilities
- Built-ins: `pass`, `bleed:<minion>`, `hunt:<minion>`, `leave:<minion>`,
  `diablerize:<actor>:<victim>`,
  `rescue:<actor>:<victim>:<actorPortion>`, `block:<minion>`,
  `strike:hand`, `press:continue|end`, `inf:add/take/out:<id>`,
  `inf:crypt`, `edge:gain`, `discard:<cardId>`, `end`
- `act:<Name>:<cardInstanceId>:<targetMinion>` — granted rush;
  `act:<Name>:<cardInstanceId>:<what>:<actingMinion>` for a non-rush grant
  (`burn`, `counter`, …; one card may grant several)
- `maneuver:credit`, `terms:<…>`, `vote:<source>:for|against`
  (source = minion id, `edge`, `caller`, or `card:<id>`),
  `diablerize:offer:<blocker>:<victim>`,
  `choice:<Name>:<cardInstanceId>:<key>:<answer>` (declining an optional
  choice is plain `pass`)

### The three gates that make an option vanish

Each has cost an hour of "why is my card not offered":

1. **Stealth/intercept are only offered when NEEDED** (p. 26). Use a
   **hunt** (+1 inherent stealth) when a test needs intercept to be live;
   use a plain **bleed** (0 vs 0) when it needs stealth to be offerable.
2. **Only one LIMITED bleed bonus per action** (p. 10) — stacking bleed
   modifiers to build a scenario does not work after the first.
3. **Reactions live in state A, not the announce cycle**, and a wake is
   only playable by a *locked* vampire — so a reacting seat's minions must
   be locked for a wake to appear.

## Testing (non-negotiable)

- Vitest. `tests/engine/` (kernel + fuzz), `tests/cards/` (per-card
  scenarios + `supported.test.ts` metadata cross-check), `tests/ui/`,
  `tests/net/`, `tests/ai/`.
- Every card implementation lands with a deterministic scenario test.
- Fuzz (`tests/engine/fuzz.test.ts`): seeded 4-seat random games to
  completion. Invariants: options non-empty with unique ids, blood within
  [0, capacity], lock-at-announcement, pool/blood conservation by
  replaying the event log. Failures report their seed.
- Run `npm run typecheck` and `npm test` before declaring anything done.

---

## Owner decisions on record

- **Never auto-skip a player** — per-seat auto-pass toggle, default off,
  applied outside the engine core.
- **Design docs get owner review before kernel code.**
- **Profiles are LOCAL ONLY** (2026-09-04). No backend: profile and
  leaderboard in browser storage, avatar as a data URI, username unique
  only within a room. A public room list would need a directory server and
  is therefore ruled out; room codes and join links cover playing with
  friends.
- **Stun** (2026-08-31; the word appears in no rulebook): lock the minion
  and put a stun counter on them; a minion with stun counters does not
  unlock as normal, and during that unlock phase all counters they had at
  the *beginning of the turn* are burned.
- **Open War's 4-counter payout goes to the card's CONTROLLER**, not to
  whoever places the fourth counter.
- **The AI plays with what a player can see** (2026-09-06): "only work off
  of the information a normal player would possibly know or can see/read
  from the table." Handing an agent the real `GameState` is out,
  permanently. It searches `redactFor(state, seat)` — the same object a
  remote player receives.
- **The AI knows its own deck** (2026-09-06): composition, never order.
  The library stays face down even to its owner (p. 14).
- Five gates were unblocked by the owner and built: the ash heap
  (2026-09-01), wraith/zombie (2026-09-02), token vampires and the Path
  cards (2026-09-03). **The blocked list is empty.**

## Known deviations (intentional)

- Clan-change and sect-change are out of scope.
- A referendum whose terms have no legal choice passes with no effect.
- Diablerie's Red List trophies are unmodelled (TODO in
  `commitDiablerie`); steps 2 and 4 (equipment take, older-victim
  Discipline) are built.
- The `.44 Magnum` bespoke handler does not honour the
  equipment-restriction static (it does honour `handStrikesOnly`).
- `spec.combatLimit` is per COMBAT FRAME where the printed limit is per
  VAMPIRE, so two combatants cannot each play their own copy in a round.
- Fuzz games end in a draw at `maxTurns` — an engine safeguard, not a
  rule.
- The acting minion may legally unlock mid-action (superior Majesty);
  "locked at announcement" is the real invariant.
- `combat.damageResolution` and `action.afterResolution` open **only when
  some seat can actually use them**, rather than cycling every seat
  unconditionally. Both are recorded deviations, both reversible on the
  owner's word.

---

## Running it

**The owner does not want to run terminal commands to play.**
**`Play VTES.bat`** at the repo root is the double-click launcher: it
checks for Node, runs `npm install` on first use only, then `npm run play`
(`vite --open`). The console window it opens IS the server — it must stay
open. If the dev command ever changes, change the `play` script rather
than the batch file.

## Commands

- `npm run play` (server + browser) / `dev` (server only) / `build` /
  `preview` / `typecheck` / `test` / `test:watch`
- `npm run simulate` — batch AI games (`-- --games 200 --seed 7
  --verbose`); exits non-zero if any game errors, so it doubles as a soak
  test
- `npm run bench` — fair mirror-match AI comparison
  (`-- --deals 200 --precon Hecata --weights k=v --against k=v --search 1`)
- `npm run cards:fetch` → `cards:sets` → `cards:registry` (KRCG pipeline;
  fetch needs network)

---

## Working with the owner

- Experienced game developer (JS/HTML games, Godot), but **new to
  TypeScript, npm tooling and terminals** — explain toolchain steps
  plainly, give exact commands, no unexplained jargon.
- Strong preferences: **plan before code**; present design tradeoffs before
  building; systems-level depth over quick hacks; headless validation
  before delivery.
- Prefers being walked through decisions rather than having them made
  silently. When a rules question is ambiguous, **cite the rulebook
  section and ask**.
- **Report the card count with every card wave** — library, crypt and
  total, re-derived from the registry (`data/registry-report.txt` prints
  them). The denominators MOVE now that the library is widening, so
  quote them from the build rather than from this file. **And regenerate
  `docs/card-status-by-set.md`** in the same pass — the owner reads it as
  the picture of platform completeness, so a stale copy misreports.
- The owner plays the build and finds real bugs by looking at the table.
  Take that feedback literally and check the rules before assuming it is
  cosmetic — half of what looks like a bug is the engine being right about
  a rule, and saying so plainly (with the citation) is the right answer.

## Reference material: Cockatrice

A Cockatrice source tree sits in the repo folder as **reference only**
(gitignored; GPL-2.0 C++/Qt). **Never port its code — including
hand-translating a file into TypeScript — as that would put this project
under the GPL.** Patterns only. See `docs/cockatrice-lessons.md`; the key
finding is that Cockatrice has **no rules engine**, which is why it
supports every MTG card with zero card implementations and equally why it
**cannot have AI players**.

---

## Design docs — the index

Every mechanic that took a decision has a doc under `docs/` (115 files).
**Read the doc before touching the mechanic** rather than re-deriving it;
each holds the rulebook citations and the readings taken.

**Start here:** `impulse-design.md` (the frame stack and impulse cycle —
§10 is the citation list), `card-primitives.md` (the CardSpec vocabulary),
`partial-support.md` (the ledger).

**Kernel / sequencing:** `impulse-design.md`, `choice-frames-design.md`,
`control-change-design.md`, `derived-traits-design.md`,
`contested-design.md`, `old-gaps-closeout.md` (the knowledge model,
leaderboard, deck library, diablerie steps 2 and 4, and withdrawal).

**Combat:** `basic-combat-design.md` (dodge/maneuver/press with no
requirement, and the "do not replace until after combat" deferral),
`strike-effects-design.md`, `ammo-design.md` (the
before-resolution window — strikes declared, not yet resolved — and the
five ammo cards that need it), `aim-design.md` (the aim rider — a payload
held until the strike it rode actually inflicts damage),
`dodge-additional-strikes-design.md`, `weapons-design.md`,
`weapon-riders-design.md`, `frenzy-design.md`, `actor-riders-design.md`,
`dawn-operation-design.md`, `outside-combat-design.md`,
`round-recurring-combat-design.md`, `combat-attachments-design.md`,
`round-end-design.md`, `last-combat-design.md`.

**Actions and blocking:** `rush-actions-design.md`,
`rush-outcome-design.md`, `granted-actions-design.md`,
`granted-rush-design.md`, `block-restrictions-design.md`,
`block-tax-design.md`, `fail-block-design.md`,
`unlock-and-block-design.md`, `end-action-design.md`,
`after-resolution-design.md`, `other-vampire-modifiers-design.md`,
`minion-target-actions-design.md`, `permanent-target-actions-design.md`.

**Politics:** `referendum-riders-design.md` (payloads that wait for the
tally, and the auto-pass grant that now carries its own card's
conditions), `crusades-design.md` (the Crusades, and the city a
card-granted title never recorded), `politics-design.md`, `abstain-gate-design.md`,
`politics-followups-design.md`, `polling-votes-design.md`,
`ballots-design.md`, `politics-locations-design.md`,
`referendum-terms-design.md`, `referendum-margin-design.md`.

**Cards and economies:** `discipline-masters-design.md` (the eleven
Discipline masters, and the §0 set-difference that decides which are in
the pool), `clan-sect-design.md`,
`on-vampire-statics-design.md`, `conditional-statics-design.md`,
`opposing-statics-design.md`, `counters-design.md`,
`cost-sources-design.md`, `counter-sinks-design.md`,
`play-cost-design.md`, `discipline-filtered-design.md`,
`library-search-design.md`, `ash-heap-design.md`, `pool-drain-design.md`,
`unlock-tolls-design.md`, `stun-design.md`,
`temporary-hand-size-design.md`, `allies-retainers-design.md`,
`vozhd-allies-design.md`, `retainer-wave-design.md`,
`archetypes-design.md`, `combat-retainers-design.md` (the three shapes a
retainer takes in a fight, and why a rate is not a cost), `wraith-zombie-design.md`,
`token-vampire-design.md`, `path-cards-design.md`,
`diablerie-design.md`, plus the lock-grant, attachment and location docs.

**Planning and audits:** `crypt-plan.md`, `crypt-wave-1.md` … `-7.md`,
`remaining-mechanics-roadmap.md`, `one-off-sweep.md`, `library-audit.md`,
`ledger-closeout.md`, `partial-support.md`, `card-status-by-set.md` (every KRCG
card by set and state — built, whole, or which wave takes it; regenerate with
`node scripts/card-status-by-set.cjs > docs/card-status-by-set.md`).

**AI:** `ai-v1-design.md` (the scoring policy and the batch harness),
`ai-bench-design.md` (the fair mirror-match harness and its controls),
`richer-options-design.md` (options carrying what the engine already
computed — §5–§8 are the measured case that weight-tweaking is exhausted),
`ai-v2-design.md` (the search agent, why `redactFor` is the state an agent
may legitimately have, and the verdict that the value function is the open
problem).

**UI, net and shipping:** `debug-ui-design.md`, `shell-design.md`,
`saved-games-design.md` (named save slots, the automatic per-turn slot,
`SavedGame.botSeats`, and the default bot names),
`lobby-design.md`, `lobby-rework-2026-09-06.md`, `multiplayer-design.md`,
`deck-import-design.md`, `fresh-game-design.md`, `game-log-design.md`,
`futile-options-design.md`, `playtest-2026-09-05.md`,
`table-ux-2026-09-11.md` (ten owner reports from one session: the
magnifier surviving a repaint, action menus and stacking contexts, seats
in table order, your own decks alphabetically, naming the action in the
log, the AI not gifting cards, and joining mid-game), `pages-design.md`,
`cockatrice-lessons.md`.

**Archive:** `project-memory-archive-2026-09-07.md` — this file as it was
before the rewrite, kept for the wave-by-wave narrative.

---

## What a new session should read first

1. **This file, top to bottom.** The scope lock, the seven architecture
   principles, the card registry rules and the testing rules are binding.
2. **The lessons section above** — the distillation of every expensive
   mistake this project has made.
3. `docs/impulse-design.md` before touching sequencing, and the specific
   doc for whatever mechanic is in play.
4. `docs/partial-support.md` **before designing against any deferral** —
   and verify it against the tree, because a deferral is a claim about the
   code as it was.
5. **If the task is a card wave** (the owner says "onto the next"):
   `docs/pool-widening-design.md` §6 for what the last waves did and why,
   `docs/card-status-by-set.md` for what is left, and "A WAVE" above for
   the rhythm. **Re-derive every count from
   `data/registry-report.txt`** rather than trusting any line in a doc,
   this one included.

Do not relitigate the settled decisions (headless engine, event sourcing,
the impulse system, the legal-move generator, the V5-only pool, the
transport seam) without the owner raising it first.
