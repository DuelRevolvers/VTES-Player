# VTES Platform — Project Memory

> **Rewritten 2026-09-07.** This file had grown to 6,382 lines of
> wave-by-wave history, much of it stale — it still listed finished phases
> as upcoming and named blockers that had been built days earlier. That
> staleness cost this project more time than any bug. Nothing is lost:
> every mechanic has its own doc in `docs/` (110 of them), which is where
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

- Card pool = the **V5 product line only**, defined in
  `config/v5-sets.json` (7 KRCG sets: Fifth Edition, Anarch, Companion,
  Sabbat V5, New Blood I–III).
- **661 unique cards** — 444 library, 217 crypt.
- The full legacy pool (~4,000 cards) is out of scope. **Never widen the
  pool without the owner's say-so.**
- *Owner decision on record:* widening beyond V5 is blessed **in
  principle** and is phase 8's job. `data/vtes-raw.json` already holds all
  4,149 KRCG cards, so widening is an edit to `config/v5-sets.json` plus
  `npm run cards:registry` — no network fetch.

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

## Status (accurate as of 2026-09-07)

**Phases 1–7 are COMPLETE.** Data pipeline, rules kernel, the entire V5
card pool, the play UI, AI v1 + batch simulation, PeerJS multiplayer with
lobby and room codes, and the deck importer (32 precons derived from the
KRCG snapshot, 18 of them playable as printed — the rest are New Blood
starters, half decks by design).

**The card pool is finished.**

- **Library 444/444 (100%)**
- **Crypt: 99/217 have implementations, and ALL 217 play correctly** — the
  other 118 print only a bare sect/title line and need no code.
- Total with an implementation: 543/661. *Re-derive these from
  `src/cards/registry.json` rather than trusting this line.*
- `docs/partial-support.md` is the ledger of supported cards with a
  known-missing clause. **Its "needs engine work" table is empty**, there
  are no `// PARTIAL:` markers left in `cards.ts`, and the cut and blocked
  lists are empty.

**Everything plays.** `npm run play` deals a real game from real decks;
bots fill any seat; two people can play over a room code.

**Green baseline: 178 test files, 1934 tests**, with `npm run typecheck`,
`vite build` and `npm run simulate` all clean. If a fresh session sees
fewer, something regressed.

**Only runtime dependency: `peerjs` ^1.5.5.**

### The queue

1. **PHASE 9 — PUBLISH.** Groundwork done and verified
   (`docs/pages-design.md`). One item left, and it needs an image editor:
   **the banner is 2160 KB of a 3.19 MB first paint (68%)**. Re-save at
   ~2200px as **WebP, not JPEG** — the alpha channel IS used (8.5% of
   pixels partially transparent, measured). Deploying is the owner's act;
   nothing in the tree publishes by itself.
2. **PHASE 8 — widen the pool beyond V5.** The months-long one. Expect the
   661 count and every tally here to need re-deriving.
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
foot of the main menu under the copyright line: **`platform v0.7.0`**.

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
   fails.
5. Add the card (and any discipline it needs) to the fuzz decks in
   `tests/engine/fuzz.test.ts`. **Every addition reshuffles every seeded
   game**, so a green fuzz before and a failure after usually means a
   pre-existing latent bug just got dealt in.
6. `npm run typecheck` && `npm test` green before done.

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
- Rutor's Hand's pay-to-opt-out.
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
- **Report the card count with every card wave** — library X/444, crypt
  X/217, total X/661, re-derived from the registry.
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

Every mechanic that took a decision has a doc under `docs/` (110 files).
**Read the doc before touching the mechanic** rather than re-deriving it;
each holds the rulebook citations and the readings taken.

**Start here:** `impulse-design.md` (the frame stack and impulse cycle —
§10 is the citation list), `card-primitives.md` (the CardSpec vocabulary),
`partial-support.md` (the ledger).

**Kernel / sequencing:** `impulse-design.md`, `choice-frames-design.md`,
`control-change-design.md`, `derived-traits-design.md`,
`contested-design.md`, `old-gaps-closeout.md` (the knowledge model,
leaderboard, deck library, diablerie steps 2 and 4, and withdrawal).

**Combat:** `strike-effects-design.md`,
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

**Politics:** `politics-design.md`, `abstain-gate-design.md`,
`politics-followups-design.md`, `polling-votes-design.md`,
`ballots-design.md`, `politics-locations-design.md`,
`referendum-terms-design.md`, `referendum-margin-design.md`.

**Cards and economies:** `clan-sect-design.md`,
`on-vampire-statics-design.md`, `conditional-statics-design.md`,
`opposing-statics-design.md`, `counters-design.md`,
`cost-sources-design.md`, `counter-sinks-design.md`,
`play-cost-design.md`, `discipline-filtered-design.md`,
`library-search-design.md`, `ash-heap-design.md`, `pool-drain-design.md`,
`unlock-tolls-design.md`, `stun-design.md`,
`temporary-hand-size-design.md`, `allies-retainers-design.md`,
`vozhd-allies-design.md`, `retainer-wave-design.md`,
`archetypes-design.md`, `wraith-zombie-design.md`,
`token-vampire-design.md`, `path-cards-design.md`,
`diablerie-design.md`, plus the lock-grant, attachment and location docs.

**Planning and audits:** `crypt-plan.md`, `crypt-wave-1.md` … `-7.md`,
`remaining-mechanics-roadmap.md`, `one-off-sweep.md`, `library-audit.md`,
`ledger-closeout.md`, `partial-support.md`.

**AI:** `ai-v1-design.md` (the scoring policy and the batch harness),
`ai-bench-design.md` (the fair mirror-match harness and its controls),
`richer-options-design.md` (options carrying what the engine already
computed — §5–§8 are the measured case that weight-tweaking is exhausted),
`ai-v2-design.md` (the search agent, why `redactFor` is the state an agent
may legitimately have, and the verdict that the value function is the open
problem).

**UI, net and shipping:** `debug-ui-design.md`, `shell-design.md`,
`lobby-design.md`, `lobby-rework-2026-09-06.md`, `multiplayer-design.md`,
`deck-import-design.md`, `fresh-game-design.md`, `game-log-design.md`,
`futile-options-design.md`, `playtest-2026-09-05.md`, `pages-design.md`,
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

Do not relitigate the settled decisions (headless engine, event sourcing,
the impulse system, the legal-move generator, the V5-only pool, the
transport seam) without the owner raising it first.
