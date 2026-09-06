# The app shell — profile, menu, new game

2026-09-04. The front of the application: who you are, what you want to
do, and what table to sit at. Until now `main.ts` booted straight into one
hand-authored mid-game snapshot and there was no way to start anything
else.

`src/ui/profile.ts`, `src/ui/newgame.ts` (no DOM), `src/ui/shell.ts` (the
screens).

---

## 1. Profiles are local only — the owner's decision, and its consequences

**Decided 2026-09-04.** Accounts, a globally unique username, a hosted
avatar and a cross-player leaderboard all need a backend with persistence.
This project has none, phase 9 ships to GitHub Pages (static), and PeerJS
is peer-to-peer rather than a server. So:

- the profile lives in this browser, beside the settings;
- the **name is unique within a room**, not in the world — and
  `buildTable` is the only place that is enforced, because seat names *are*
  the engine's seat ids;
- the **avatar is a data URI**, downscaled to 128×128 before storage. Not
  a nicety: the whole origin has a few megabytes of localStorage, shared
  with the settings and the saved game, so an unscaled phone photo would
  **evict the saved game** rather than merely being wasteful. A backstop
  limit is checked on the way in as well;
- the **leaderboard is per device**, and the screen says so rather than
  showing an empty table that looks broken.

`nameProblem` is deliberately permissive about content — accents,
punctuation and non-Latin scripts are all somebody's real name. What it
refuses is what breaks something downstream: empty, too long for a seat
label, or containing control characters, which could corrupt a lobby list
or a log line.

## 2. The decisions are separated from the screens

`newgame.ts` has no DOM in it. A `TableConfig` — seats, who plays each,
what deck — goes in; a `GameSetup` or a list of problems comes out. That
is where the tests are. `shell.ts` is markup and event wiring.

**Every problem is collected, never the first one thrown**: a player
fixing a lobby wants the whole list, not one error per attempt.

Rendering follows the table's model (docs/debug-ui-design.md §3): a screen
is a pure function of the shell's state, re-rendered whole. One exception,
and it is the usual one — a seat name box repaints on **blur**, not on
every keystroke, because re-rendering would take the caret out of the box
being typed in. (The How to Play search solves the same problem the other
way, by restoring the caret; here there is nothing to restore to.)

## 3. What the default table is, and why

**You plus three bots, each on a different precon, ready to start with no
further choices.** p. 1 says the game is "for four or five players", which
is where four comes from; 2–6 will play, and the
screen prints the recommendation rather than pretending two is typical.

Each seat gets a *different* precon on purpose — a first game that is four
copies of one deck playing itself teaches a new player nothing. A test
pins it, because it is the kind of thing an innocent refactor undoes.

Decks come from the importer built the same day: a precon picker (18
playable as printed) or a pasted list from any deck-building site, with
the full import report kept and shown. An unsupported card is **something
to read**, not only something to block on.

## 4. Seeds: "a different game each time" must not mean "unreplayable"

A null seed means the shell picks one — but it picks it **once, into the
`GameSetup`**, rather than leaving it unset. So the game is still exactly
reproducible from its save and from its log file, which both carry the
setup. A test builds two tables with no seed, asserts they differ, and
asserts each is stable when re-dealt.

## 5. What this makes possible today

**Private play is finished.** Menu → Host → Start deals a real game from
real decks with bots in the other seats, logged to `logs/`, at whatever AI
pace is set. That is the owner's "option to play privately, meaning not
online", and it needed no new engine work — the bots and the log were
already built and simply had no menu.

**Online play works too**, as of the same day: set a seat to *Open
(online)* and Start opens a room instead of dealing
(docs/lobby-design.md). Join takes a room code, or a join link opens
straight into one.

## 6. Not done yet

- **No deck library.** The Profile screen is settings only; saving named
  decks is its own small store.
- **No leaderboard data.** The per-game logs already record the result, so
  the source exists; nothing reads them back yet.
- **`startFromConfig` is no longer the entry point** but is kept: the
  playtest snapshot is still the fastest way to reach a mid-game position
  for a hands-on look at a card, and a fresh deal spends its first turns
  influencing on purpose.
