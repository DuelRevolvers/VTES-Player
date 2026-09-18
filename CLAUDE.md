# VTES Platform — Project Memory

> **This file is only what is BINDING and what is TRUE.** It is sent with
> every request, so every line here is paid for on every turn.
>
> **SIZE RULE (binding, 2026-09-17).** Wave post-mortems, per-card
> narrative and mechanic detail go in the wave's own `docs/*-design.md`
> and in `docs/pool-widening-design.md` §6 — **never here.** This file
> carries rules, current counts and pointers. It was rewritten on
> 2026-09-07 after growing to 6,382 lines of stale wave history, and
> trimmed again on 2026-09-17 after the bucket table and the lessons had
> re-grown by half. When you finish something, **update** the status and
> the queue rather than appending to them. If a section is getting longer
> every wave, it is in the wrong file.
>
> Old copy: `docs/project-memory-archive-2026-09-07.md`.

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
extracts cleanly with a ~40-line Node script using only `zlib`. Verified
sequencing citations: `docs/impulse-design.md` §10. **When card text
contradicts the rulebook, card text wins** (the Golden Rule, p. 16).

## Scope (locked)

- **Library** = the **V5 product line** (`config/v5-sets.json`: 7 KRCG
  sets) **plus any legacy card that has been implemented.** A legacy
  library card is admitted by `config/supported.json` alone — for the
  library, "implemented" and "may be in the pool" are the same question
  (`docs/pool-widening-design.md` §6).
- **Crypt** = the V5 sets only. The machinery to widen past them exists
  and is deliberately switched OFF: `config/crypt-groups.json` is
  `"groups": []`.
- **Widening is a PIPELINE, not a switch** (`docs/pool-widening-design.md`).
  Opening a group admits only vampires that are already whole — the
  builder gates on it, so the pool can never get ahead of the card waves.
  A 2026-09-08 widening to 1,680 crypt cards was rolled back because it
  admitted 1,104 inert abilities; the gate is what stops that recurring.
  To widen: implement a clan's abilities, open its groups,
  `npm run cards:registry`.
- `data/vtes-raw.json` already holds all 4,149 KRCG cards, so every
  widening is a config edit plus a rebuild — no network fetch.
  **Never widen without the owner's say-so.**
- **The crypt is cheap to ADMIT and not cheap to FINISH.** An
  unimplemented crypt ability is reported as inert rather than blocking
  the deck, which is exactly why the gate exists rather than being left
  to judgement.

**ALL COUNTS ARE DERIVED.** Re-read them from `data/registry-report.txt`
(library / crypt / total / supported) and `docs/card-status-by-set.md`
(what is left, by bucket). Never trust a count written in a doc.

---

## Architecture principles (settled — do not relitigate)

1. **Headless engine.** `src/engine/` is pure TypeScript: no DOM, no
   networking, no rendering. It runs in Node for tests and batch AI.
2. **Deterministic + event-sourced.** All randomness through a seeded RNG.
   Game = initial state + command sequence. State fully serializable.
   This is what makes replays, reconnection, undo and reproducible bugs
   work.
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

## Status

**Phases 1–7 are COMPLETE.** Data pipeline, rules kernel, the V5 card
pool, the play UI, AI v1 + batch simulation, PeerJS multiplayer with lobby
and room codes, and the deck importer (32 precons; 18 playable as
printed — the rest are New Blood starters, half decks by design, offered
in the chooser labelled and exempt from p. 14's two minimums BY SEAT).

**The card pool is WHOLE — every card in it does everything it prints**,
asserted over the whole registry by `tests/cards/no-partial-cards.test.ts`.

- **Library: 100% of what is admitted** — the V5 sets plus the legacy
  cards taken by the waves. Growing every wave.
- **Crypt: V5 only.** Some print an ability and have an implementation;
  the rest print none and need none. Both kinds are whole; there is no
  third kind.
- **Fourteen library cards are whole-but-inert** (wave 45): their printed
  clan icon names a clan no V5 vampire has. §0 says inert cards leave the
  pool; pulling them means pulling their specs and tests, so it waits on
  the owner's word (`docs/plain-allies-design.md` §0). They cost nothing
  the day §7 opens their clans.
- `docs/partial-support.md` is the ledger of cards with a known-missing
  clause. **Its "needs engine work" table is empty**, there are no
  `// PARTIAL:` markers in `cards.ts`, and the cut and blocked lists are
  empty.
- **`docs/card-status-by-set.md` is the whole picture** — every one of the
  4,149 KRCG cards by set and state, the 32 V5 precons with their
  implemented % and whether each is playable as printed (two different
  questions), and the 49 legacy precons as a REPORT that admits nothing.
  It is **GENERATED**: regenerate it in the same pass as any card wave
  (`node scripts/card-status-by-set.cjs > docs/card-status-by-set.md`) and
  never hand-edit its numbers.

**Everything plays.** `npm run play` deals a real game from real decks;
bots fill any seat; two people can play over a room code.

**Green baseline: 250 test files, 2539 tests**, with `npm run typecheck`,
`vite build` and `npm run simulate` all clean. If a fresh session sees
fewer, something regressed.

**Saved games and default bot names** landed 2026-09-09
(`docs/saved-games-design.md`): named slots plus a **Last game** slot the
table rewrites every turn, loadable from there or from a `.json` file. A
save records **which seats were bots** (`SavedGame.botSeats`).

**Only runtime dependency: `peerjs` ^1.5.5.**

### The queue

1. **PHASE 9 — PUBLISH.** Groundwork done and verified
   (`docs/pages-design.md`). One item left, and it needs an image editor:
   **the banner is 2160 KB of a 3.19 MB first paint (68%)**. Re-save at
   ~2200px as **WebP, not JPEG** — the alpha channel IS used (8.5% of
   pixels partially transparent, measured). Deploying is the owner's act;
   nothing in the tree publishes by itself.

2. **PHASE 8 — widen the pool beyond V5** (`docs/pool-widening-design.md`).
   **The CRYPT is deliberately still V5-only; the LIBRARY is widening,
   one implemented card at a time.** The config split, the crypt group
   rule, the sect/title fixes and the ambiguity-resolving deck importer
   all landed. **Widening is downstream of card work:**
   - **§6 — the library, IN PROGRESS.** Three tranches in order: **T1**
     no discipline, **T2** only disciplines the V5 crypt already has,
     **T3** a legacy discipline. The library comes first because the
     nearest crypt cards carry legacy disciplines nothing in the pool yet
     requires.
   - **§7 — the crypt abilities.** Clan-by-clan waves, each of which lets
     its clan's groups be opened in `config/crypt-groups.json`. Over a
     thousand legacy vampires print an ability with no implementation; a
     few hundred print none and enter free the day their group opens.

   **What is left, by bucket:** re-derive from
   `docs/card-status-by-set.md` (regenerate it with
   `scripts/card-status-by-set.cjs`). Buckets, largest first: Master,
   Action, Political Action, Equipment, Ally, Action Modifier, Reaction,
   Event, Combat, Retainer, mixed types. **Conviction is out of scope**
   (imbued-only, no engine model).

   **For what a bucket's last waves did and what they found, read
   `docs/pool-widening-design.md` §6** — it has a section per wave, newest
   first. Do not duplicate it here.

   **If a family needs an ability the engine does not have, BUILD IT**
   (owner rule, 2026-09-12). A missing mechanic is not a reason to defer a
   batch of cards. Deferring stays right for a card that is *inert* (§0)
   or whose clause the pool cannot express at all.

   **Sequence by MECHANIC, never alphabetically.** A wave is a family
   sharing a primitive — that is what makes one new primitive pay for four
   or five cards and what makes the negative-space tests meaningful.

3. **AI.** Weight-tweaking is exhausted, demonstrably
   (`docs/richer-options-design.md` §5–§8). A search agent exists, is
   guarded, and is **not better yet**; the unsolved part is the VALUE
   FUNCTION, then modelling an opponent's reply — which needs sampling
   their hidden cards and is always a guess, because deck lists are
   private.

---

## The lessons that keep paying (read these)

Distilled from ~60 card waves and several playtests. Each has bitten more
than once. **One line each on purpose** — the full story is in the design
doc named beside it.

### Before you build

- **READ THE RULINGS BEFORE CHOOSING THE TYPE, not after.** A near-miss in
  the TYPE is invisible to every test you would think to write — a boolean
  that should be a named value, a `+1 level` that should be `set to
  superior` (`cancel-in-combat-design.md`, `discipline-granting-equipment-design.md`).
- **A deferral is a claim about the code AS IT WAS — and so is a
  NON-deferral.** Five cut-list rows in eight waves named a blocker that
  had since been built. Check the tree before designing against a note;
  "it already exists" is a claim to CHECK, not to make.
- **A card can be WHOLE and still be INERT, and the pool wants neither.**
  Before implementing a card that filters on a clan, title, sect, card
  type or DISCIPLINE, check the pool actually contains one (Tradition
  Upheld needs a Caitiff; Gangrel Justicar a Camarilla Gangrel; Mokolé
  Blood a Serpentis card — the V5 pool has none of the three).
- **A CLAN ICON on a minion card is a REQUIREMENT (p. 10)** and KRCG's
  text does not repeat it. Registry `clans` non-empty on a minion-type
  card ⇒ `requiresClans()` non-empty. Masters are the exception.
- **The registry's clan names are not the card's.** Text says Assamite and
  Follower of Set; the registry says Banu Haqim and Ministry. A filter
  spelled from the card text matches nothing, silently.
- **A set derived from "the registry" has to name its card KIND.** A
  library card's clan is an ICON, not a vampire; the two sets stopped
  being equal when the legacy library arrived.
- **A parenthetical often DESCRIBES existing behaviour** rather than
  asking for new behaviour. Building to it is how a re-entrancy bug gets
  written. Five instances.

### Tests that lie

- **Empty for the wrong reason.** A filter matching nothing, an empty
  option list, a zero — these look identical whether correct or broken.
  The fuzz **structurally cannot** see a too-permissive or too-narrow
  option list; only negative-space assertions catch it.
- **A GUARD CLAUSE IN A TEST IS A SILENT SKIP.** A fixture a test needs,
  the test BUILDS; what it cannot build, it asserts is there.
  (`threeSeatGame`'s uncontrolled region is empty and its
  `masterActionsLeft` is 0 — both have passed a test for the wrong
  reason.)
- **WHEN EVERY CASE IN A TEST IS A NEGATIVE, the test is telling you about
  the FIXTURE, not the card.** A test with no passing positive has not
  tested anything.
- **An assertion about a total set is a hostage to every future change.**
  Pin the *reason*, not the count.
- **A card in the fuzz decks is not a card the fuzz can PLAY**, and a card
  it can play is not a GATE it can open. Tally what is actually OFFERED
  after a deck change. **The ten standing seeds are a regression guard,
  not a search** — widening to 120 seeds found two engine throws the ten
  never reach.
- **A green fuzz before and a red one after a deck change is usually a
  latent bug being dealt in, not a new one.** Read it as a report about
  the ENGINE first.
- **A walker that takes `options[0]` plays the board.** Test walkers must
  prefer `pass`, then `end`. And a fixture that sets blood to 0 has
  enabled a MANDATORY hunt (p. 21) — seven instances.
- **Measure before you design, and on more than one deck.** A measuring
  instrument needs a negative control (A vs A is a dead heat) *and* a
  positive one (a crippled policy loses), or "no difference" means
  nothing.

### Things that drift

- **One question asked in two places will drift.** Funnel through one
  helper. And when you add a RICHER record, re-point the readers of the
  poorer one.
- **When you add a hook to a FAMILY, re-read the SIBLINGS** — they were
  written at different times and they do not agree. Same for option
  enumerators (`meetsRequirements` has been forgotten four times), for
  the two put-in-play compilers, and for card FACTORIES
  (`praxisSeizure` was fixed; the Justicars beside it were not).
- **A hook that iterates `seat.permanents` does not exist for attached
  cards** — and every crypt ability is attached. Use `allEntries()`. **It
  is not only hooks:** an APPLY and a TALLY have had it too.
- **A RULE WELDED TO A CARD TYPE IS NOT SHARED, IT IS MERELY NEARBY.**
  `spec.weapon` compiled inside `compileEquipment`, though what a weapon
  does is a question about the ENTRY IN PLAY
  (`armed-mid-combat-design.md`).
- **A COMMENT CLAIMING "one place" is a claim to CHECK.** Rules inside a
  loop are not shared; a function is (`before-range-attachments-design.md`).
- **A VOCABULARY KEPT IN A REGEX IS A LIST NOBODY GREPS.** Adding a
  `vulnerableTo` outcome teaches three sites that read as a set — and a
  fourth, a regex spelling the verbs, three thousand lines away. When you
  add a case to a union, grep for a SIBLING's *value*
  (`blood-banking-locations-design.md`).
- **HALF-RIGHT IS THE WORST STATE FOR A BUG, because the obvious test
  passes.** Two Justicars contested their TITLES correctly and their CARDS
  not at all (`justicars-design.md`).
- **Machinery documented as general quietly does not apply to one case.**
  `onAnyUnlock`, `onBleedSuccess` and `onMasterPhase` each missed attached
  cards; `onActionAnnounced` fired one step early for its whole life;
  `onEnterPlay` never fired for a card that puts ITSELF in play on a
  successful action. The tell each time: that path emits the entry event
  by hand instead of going through the shared helper.
- **A new call beside an existing one should copy its GUARDS before its
  shape.** The guards around a line are part of what that line means.

### Reads and layers

- **A derived read must be TOTAL.** A minion can leave play at any point —
  an ally's life IS its blood. Use `findMinion`, never `getMinion`, in
  derived code and option enumerators.
- **A strike is CHOSEN in one window and RESOLVED in another**, and a
  combatant can leave the table in between. Same family: prevention costs,
  and any target list chosen at announcement.
- **A FILTER THAT READS A STATE THE ANNOUNCEMENT CHANGES IS EVALUATED
  TWICE, AND THE TWO DISAGREE.** Options are enumerated before the actor
  locks (p. 25). Exclude the actor at enumeration; re-derive the target
  set at resolution (`blood-bank-actions-design.md`).
- **AN EARLY RETURN MEANING "NOTHING TO DO" STOPS BEING TRUE the day the
  effect gains a term that does not depend on the count.** The tell is a
  constant in the card's sentence (`table-pool-swings-design.md`).
- **A condition can be unanswerable in the LAYER you put it in.** Before
  putting a condition in an existing layer, check what that layer is given
  when it is asked (`fee-stake-design.md`).
- **A field that exists at TWO LEVELS needs its READER checked, not its
  spelling.** `usable` sits on the spec and on the mode; the gate reads
  the mode's.
- **A handler lookup cannot answer a question whose answer differs by
  mode.** Denormalize onto the frame or the entry (the `isMaster`
  treatment).
- **A ZONE RECORDS WHAT TODAY'S READERS NEED, AND IS WRONG FOR
  TOMORROW'S.** Write the answer down as the thing leaves play; the tell
  is a card interrogating something already filed away
  (`ash-heap-resource-design.md`).
- **Anything scoped to a live frame is DERIVED on every read, never
  stored.** A combat ends four different ways; a flag cleared at all of
  them will one day survive one.
- **Which seat an ability belongs to is a per-card question**, and getting
  it backwards offers the card to nobody, silently. Bitten five times.
- **Restoring a widget after a repaint means restoring everything the
  repaint threw away** — inline style is the easy one to forget, because
  nothing in the markup shows it was there
  (`table-ux-2026-09-11.md`).
- **A feature that cannot be discovered is indistinguishable from one that
  is absent.** Reported twice by the owner about features that worked.

---

## Version numbering (BINDING — owner rule, 2026-09-07)

The platform version shows in small text at the foot of the main menu.

- **It lives in `src/version.ts`** (`PLATFORM_VERSION`), the single source
  of truth. `package.json` carries the same string and
  `tests/ui/version.test.ts` fails if they drift.
- **BUMP IT BY 0.0.1 EVERY TIME CHANGES ARE MADE** — a card wave, a bug
  fix, a UI tweak each earn exactly one. This is a build counter people
  can quote in a bug report, not semver: do not reserve the patch digit
  for "small" changes or save several up for one bump.
- Bump it in the same pass that edits the code, so a build and its number
  cannot disagree.
- **Read the current version from the file**, never from a doc.

## No partial cards (BINDING — owner rule, 2026-09-08)

> *"We can't half-ass any card, ever. We need all cards added to this
> platform working at 100% entirely or we literally can't play the game
> correctly. Never skimp on building cards."*

A card is **in the pool** only when it does everything it prints. Not most
of it, not the common case, not "that clause is rare".

- **A vampire's printed ability counts.** A crypt card whose ability does
  nothing plays wrong every time it would have mattered, and nothing on
  the table shows it happening.
- **"Reported as inert" is not a substitute for implemented.**
  `inertAbilities` exists so a playtest is not misled — never as a licence
  to ship the card that way.
- **Admitting a card to the registry is a promise about it.**
- This outranks any counting argument. "Cheap" in a design doc means cheap
  to ADMIT (`docs/pool-widening-design.md` §0 and §7).
- **It is enforced, not trusted.** `tests/cards/no-partial-cards.test.ts`
  asserts it over the whole registry, and `widenedCrypt` in
  `scripts/build-registry.mts` refuses a card that fails it. Do not weaken
  either to make a widening land.

## Card registry rules

- `src/cards/registry.json` is **generated** (cards AND the 32 precon
  decks) — never hand-edit. Rebuild with `npm run cards:registry`.
- `config/supported.json` (card id → true) is hand-maintained. A card may
  be flipped to supported **only** when it has (a) an effects
  implementation and (b) a passing scenario test. The pipeline reads it,
  never writes it.
- Deck import validates against the registry and reports unsupported
  cards — never silently drops or breaks.

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
   fails. Then regenerate `docs/card-status-by-set.md` (owner rule,
   2026-09-09) — never hand-edit its numbers.
5. Add the card (and any discipline it needs) to the fuzz decks in
   `tests/engine/fuzz.test.ts`.
6. `npm run typecheck` && `npm test` green before done.

### A WAVE (what the owner means by "onto the next")

A wave is 3–6 cards that **share a mechanic**, not a letter of the
alphabet. Picking the family is most of the work: one new primitive should
pay for the whole wave, and the cards should differ in ways worth
asserting against each other.

1. **Pick the family** from the bucket list, and **check the pool can
   actually produce its targets** — inert cards stay out (§0).
2. **Read the printed text from the raw snapshot**, not from memory, and
   **read the RULINGS**.
3. Implement, test and admit each card by the six steps above.
4. **Bump `src/version.ts` and `package.json` by 0.0.1** in the same pass.
5. **`npm run typecheck`, `npm test`, `npx vite build`, `npm run
   simulate`** — all four, every wave.
6. **Update three files**: a wave section in
   `docs/pool-widening-design.md` §6, the counts and green baseline in
   this file, and `docs/card-status-by-set.md` (regenerated).
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
  (`burn`, `counter`, `raid`, …; one card may grant several)
- `maneuver:credit`, `terms:<…>`, `vote:<source>:for|against`
  (source = minion id, `edge`, `grant`, `caller`, or `card:<id>`),
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
  is ruled out; room codes and join links cover playing with friends.
- **Stun** (2026-08-31; the word appears in no rulebook): lock the minion
  and put a stun counter on them; a minion with stun counters does not
  unlock as normal, and during that unlock phase all counters they had at
  the *beginning of the turn* are burned.
- **Open War's 4-counter payout goes to the card's CONTROLLER**, not to
  whoever places the fourth counter.
- **The AI plays with what a player can see** (2026-09-06). Handing an
  agent the real `GameState` is out, permanently. It searches
  `redactFor(state, seat)` — the same object a remote player receives.
- **The AI knows its own deck** (2026-09-06): composition, never order.
  The library stays face down even to its owner (p. 14).
- Five gates were unblocked by the owner and built: the ash heap,
  wraith/zombie, token vampires and the Path cards. **The blocked list is
  empty.**

## Known deviations (intentional)

- Clan-change and sect-change are out of scope.
- A referendum whose terms have no legal choice passes with no effect.
- Diablerie's Red List trophies are unmodelled (TODO in
  `commitDiablerie`); steps 2 and 4 are built.
- The `.44 Magnum` bespoke handler does not honour the
  equipment-restriction static (it does honour `handStrikesOnly`).
- **Equipment statics that become COMBAT CREDITS are read once, when the
  combat frame is pushed** — so "cannot use equipment" applied at block
  resolution cannot take back a maneuver credit already summed
  [RTR 20010710]. `docs/discipline-granting-equipment-design.md` §3.
- `modeCombatLimit` is per COMBAT FRAME where the printed limit is per
  VAMPIRE, because `cf.playedHistory` does not record modes.
- Fuzz games end in a draw at `maxTurns` — an engine safeguard, not a
  rule.
- The acting minion may legally unlock mid-action (superior Majesty);
  "locked at announcement" is the real invariant.
- `combat.damageResolution` and `action.afterResolution` open **only when
  some seat can actually use them**. Both reversible on the owner's word.

---

## Running it

**The owner does not want to run terminal commands to play.**
**`Play VTES.bat`** at the repo root is the double-click launcher: it
checks for Node, runs `npm install` on first use only, then `npm run play`
(`vite --open`). The console window it opens IS the server — it must stay
open. If the dev command changes, change the `play` script, not the batch
file.

## Commands

- `npm run play` (server + browser) / `dev` / `build` / `preview` /
  `typecheck` / `test` / `test:watch`
- `npm run simulate` — batch AI games (`-- --games 200 --seed 7
  --verbose`); exits non-zero if any game errors, so it doubles as a soak
  test
- `npm run bench` — fair mirror-match AI comparison
- `npm run cards:fetch` → `cards:sets` → `cards:registry` (KRCG pipeline;
  fetch needs network)

---

## Working with the owner

- Experienced game developer (JS/HTML games, Godot), but **new to
  TypeScript, npm tooling and terminals** — explain toolchain steps
  plainly, give exact commands, no unexplained jargon.
- Strong preferences: **plan before code**; present design tradeoffs
  before building; systems-level depth over quick hacks; headless
  validation before delivery.
- Prefers being walked through decisions rather than having them made
  silently. When a rules question is ambiguous, **cite the rulebook
  section and ask**.
- **Report the card count with every card wave** — library, crypt and
  total, re-derived from `data/registry-report.txt`. **And regenerate
  `docs/card-status-by-set.md`** in the same pass; the owner reads it as
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

162 files under `docs/`, one per mechanic that took a decision. **Read the
doc before touching the mechanic** rather than re-deriving it; each holds
the rulebook citations and the readings taken. `ls docs/` for the current
list — names are `<mechanic>-design.md`.

**Start here:** `impulse-design.md` (the frame stack and impulse cycle;
§10 is the citation list), `card-primitives.md` (the CardSpec vocabulary),
`partial-support.md` (the ledger), `pool-widening-design.md` §6 (every
card wave, newest first).

**Kernel / sequencing:** impulse, choice-frames, control-change,
derived-traits, contested, old-gaps-closeout.

**Combat:** cancel-in-combat, armed-mid-combat, one-each-round,
conditional-weapons, basic-combat, first-strike, first-strike-cards,
strike-effects, strike-sources, ammo, aim, dodge-additional-strikes,
weapons, weapon-riders, one-shot-weapons, frenzy, actor-riders,
dawn-operation, outside-combat, round-recurring-combat,
combat-attachments, round-end, last-combat.

**Actions and blocking:** lock-as-currency, buying-a-block, rush-actions,
rush-outcome, granted-actions, granted-rush, block-restrictions,
block-tax, fail-block, no-combat, unlock-and-block, end-action,
after-resolution, other-vampire-modifiers, second-minion-modifiers,
minion-target-actions, permanent-target-actions.

**Politics:** table-pool-swings, justicars, table-referendums,
referendum-blood, referendum-riders, crusades, fee-stake,
acting-minion-reactions, politics, abstain-gate, politics-followups,
polling-votes, ballots, politics-locations, referendum-terms,
referendum-margin.

**Cards and economies:** blood-bank-actions, blood-banking-locations,
the-edge, ash-heap-resource, before-range-attachments,
vehicles-and-havens, burn-the-equipment, discipline-granting-equipment,
events, gehenna-events, gehenna-unlock, counter-clock-events,
table-rule-events, gehenna-taxes, discipline-masters, clan-sect,
on-vampire-statics, conditional-statics, opposing-statics, counters,
cost-sources, counter-sinks, play-cost, discipline-filtered,
library-search, store-plays, ash-heap, pool-drain, unlock-tolls, stun,
transfer-currency, temporary-hand-size, allies-retainers, destroyer-allies,
vozhd-allies,
retainer-wave, retainer-prices, retainer-upkeep, archetypes,
combat-retainers, wraith-zombie, token-vampire, path-cards, diablerie,
plus the lock-grant, attachment and location docs.

**Planning and audits:** crypt-plan, crypt-wave-1…-7,
remaining-mechanics-roadmap, one-off-sweep, library-audit,
ledger-closeout, partial-support, card-status-by-set.

**AI:** ai-v1-design, ai-bench-design, richer-options-design, ai-v2-design.

**UI, net and shipping:** debug-ui, shell, saved-games, lobby,
lobby-rework-2026-09-06, multiplayer, deck-import, fresh-game, game-log,
futile-options, playtest-2026-09-05, table-ux-2026-09-11, pages,
cockatrice-lessons.

**Archive:** `project-memory-archive-2026-09-07.md`.

---

## What a new session should read first

1. **This file, top to bottom.** The scope lock, the seven architecture
   principles, the card registry rules and the testing rules are binding.
2. **The lessons section above** — the distillation of every expensive
   mistake this project has made.
3. `docs/impulse-design.md` before touching sequencing, and the specific
   doc for whatever mechanic is in play.
4. `docs/partial-support.md` **before designing against any deferral** —
   and verify it against the tree.
5. **If the task is a card wave:** `docs/pool-widening-design.md` §6 for
   what the last waves did and why, `docs/card-status-by-set.md` for what
   is left, and "A WAVE" above for the rhythm. **Re-derive every count
   from `data/registry-report.txt`.**

Do not relitigate the settled decisions (headless engine, event sourcing,
the impulse system, the legal-move generator, the V5-only crypt, the
transport seam) without the owner raising it first.
