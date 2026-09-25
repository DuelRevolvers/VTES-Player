# VTES Player

**Play *Vampire: The Eternal Struggle* in your browser: against friends,
against the computer, or both.**

A free, non-commercial fan project. Nothing to install, nothing to buy, no
account to make.

---

## What is this?

*Vampire: The Eternal Struggle* is a card game where each player is an
ancient vampire, a **Methuselah**, trying to destroy the player to their
left while surviving the one on their right. It is a great game with a
small problem: you need four or five people in the same room.

This is a version you can play in a web browser, and **the computer will
fill any empty seats**. So you can:

- play a full game on your own, against bots,
- play with one friend and let bots take the other chairs,
- or get a whole table together online with a room code.

It knows the rules. It won't let you make an illegal play, it works out
what you're allowed to do at every moment, and it explains what happened
in plain English as the game goes along.

## What you need

Just a desktop or laptop web browser. It is not built for phones or
tablets, because there is too much on the table to see at once.

## How to play

The main menu has everything: **Host a game**, **Join a game**, **Deck
Builder**, **Settings**, **Leaderboard** and **How to Play**.

**Start a game**

1. Open **Settings** and make a profile: just a name, and a picture if you
   want one. It is stored in your own browser and goes nowhere else.
2. Choose **Host a game**.
3. You get a table of four seats: you, and three bots on different
   preconstructed decks. Press **Start** and you are playing.

**Play with other people**

1. On the table screen, change a seat from **Bot** to **Open (online)**.
2. A **room code** appears, something like `K7M2QP`. There is also a
   copy-able join link.
3. Send it to whoever you want to play with. They choose **Join a game**,
   type the code, pick a deck, and they are in.
4. When everyone has arrived, press **Start**.

Any seats you leave as bots stay bots, so you never need a full table to
get a game going.

**Build or bring your own deck**

The **Deck Builder** has three tabs:

- **My decks**: every deck you have saved. Open one to read it as a list
  or as card scans, then edit, rename or delete it.
- **Build a deck**: start from one of the preconstructed decks, from one of
  your own, or from scratch. Your deck sits on the left and a card search
  on the right. The search can be narrowed to the disciplines, clans and
  sects your crypt can actually use, and it points out any card in your
  deck that none of your vampires can play. If you close with unsaved
  changes, it asks first, and it always asks before saving over a deck.
- **Card search**: search all 4,149 cards ever printed. Each is marked as
  playable here, partly implemented, or not in the player yet. Hover a
  card to see it full size.

You can also paste a deck list from VDB, Amaranth, ARDB, JOL, Lackey or the
tournament archive, and the importer reads all of them. If a card isn't in
the pool or isn't implemented yet, it tells you exactly which line, rather
than quietly dropping it.

There are **32 preconstructed decks** built straight from the official
card data. 18 are complete decks you can play as printed; the rest are the
New Blood starter half decks, which are offered too, clearly labelled. You
can build your own half decks as well.

**If you're new to the game**

**How to Play** is on the main menu and at the top of the table. It is a
summary of the rules, each section tagged with the rulebook page it came
from, so you can check anything against the real book. It has a search
box, and it covers the words that appear on cards but not in the rulebook.

## What's in it

- **1,034 cards in the pool, and every one of them plays correctly**: 817
  library cards and 217 vampires. That is the whole V5 range plus a growing
  number of older cards from before V5, added a few at a time. A card only
  goes in once it does everything it prints; there are no half-working
  cards. (Exact numbers: 916 needed code written for them, and the other
  118 are vampires whose card text is just their sect and title, so there
  is nothing to implement.)
- **Computer players** that see only what a real player in that seat would
  see, and choose only from legal moves. They vote sensibly in politics,
  aim their own referendums at their prey, understand combat range, and
  try not to throw their pool away when they are running low.
- **Bot playstyles.** Each preconstructed deck comes with a style that
  suits it (Balanced, Bruiser, Stalker, Turtle, Politician or Builder), and
  you can override it for any bot in **Settings > Bots**. You can also give
  the bots your own names there.
- **Online play for 2 to 6 people**, though the rulebook recommends four or
  five.
- **Undo, save and load.** Save to named slots or to a file. There is also
  a **Last game** slot that is updated every turn, so a closed tab never
  loses your game. A save remembers which seats were bots and how each one
  was playing.
- **Keyboard shortcuts** for passing, picking options, undo, save, load and
  more. Change them in **Settings > Controls**.
- **A pass clock** for online games (off by default, host only). It can
  time out a player who is holding up somebody else's turn, but never
  someone on their own turn, and it can only take an answer the rules
  already allow.
- **Table chat**, in the lobby and during the game.
- **A game log** in plain English, so you can see exactly what happened.
- **A leaderboard** of your results, kept in your browser.

## Some honest limitations

- **There is no server.** No accounts, no matchmaking, and **no list of
  public games**: you play with people you send a code to. Your profile,
  your decks and your results all live in your own browser and nowhere
  else. Clearing your browser data clears them.
- Online play connects the players' browsers directly to each other. A
  free public service is used only to introduce them at the start; nothing
  about your game passes through it.
- The **host runs the game**. If the host closes their tab, the table ends.
  If any other player leaves, a bot takes their seat and the game carries
  on.
- The computer players are **decent, not clever**. They play a real game
  and follow the rules exactly, but they will not out-think an experienced
  player. The playstyles change how a bot plays, not how well.
- The vampires are still **V5 only**. Older library cards are being added
  steadily; older vampires come later.

## Playing on your own machine

Double-click **`Play VTES.bat`**.

It checks that Node.js is installed, sets things up the first time only,
then opens the game in your browser. The black window that appears **is**
the game's server: leave it open while you play, and close it when you're
done. If Node.js is missing, it tells you where to get it.

To reach it faster: right-click `Play VTES.bat` > **Show more options** >
**Send to** > **Desktop (create shortcut)**.

Playing this way also writes a full log of each game into a `logs/` folder,
which is handy for reporting a bug.

## Playing online

The published version runs on GitHub Pages. See
[PUBLISHING.md](PUBLISHING.md) for how to put your own copy up. It is a
plain static site: no server to run and nothing to pay for.

## Reporting a bug

The version number is at the foot of the main menu (for example
`platform v0.11.19`). Please include it, and the game log if you have one.

---

## A note on how this was made

**This project was written with [Claude](https://claude.ai), Anthropic's
AI assistant**, working from the official rulebook and the card data, with
a human directing the design, testing it and making the calls on rules
questions.

That is worth saying plainly for two reasons. If you find a bug, it is
probably a machine-shaped bug rather than a typo: an unusual card
interaction rather than a missing semicolon. And if you want to check
something, the reasoning behind nearly every decision is written down. The
`docs/` folder holds a design note per mechanic, each quoting the rulebook
page it came from, so you can tell a rules summary from an invention.

The whole thing is covered by **over 3,100 automated tests**, including
computer-versus-computer games played to a finish, so the rules engine is
checked rather than hoped for.

---

## Credits and legal

Portions of the materials are the copyrights and trademarks of Paradox
Interactive AB, and are used with permission. All rights reserved. For more
information please visit
[worldofdarkness.com](https://www.worldofdarkness.com).

This is a **non-commercial fan project** released under the
[Dark Pack](https://www.paradoxinteractive.com/games/world-of-darkness/community/dark-pack-agreement)
agreement. It is not for sale, contains no advertising, and never will.

Card text and images come from [KRCG](https://static.krcg.org/), the
official VEKN card data, used with permission.

*Vampire: The Eternal Struggle* was designed by Richard Garfield. Go and
buy the real cards. They are lovely, and this is no substitute for
sitting round a table with them.

---

## For developers

```
npm install                # once
npm run play               # server + opens the browser (what the launcher runs)
npm run dev                # server only
npm run typecheck
npm test
npm run simulate           # batch AI games, e.g. -- --games 200 --seed 7
npm run simulate:politics  # the same, on a table heavy with politics
npm run bench              # fair mirror-match AI comparison, e.g. -- --style turtle
```

**Layout**

- `src/engine/`: the rules, as a pure headless library. No DOM, no
  network. Deterministic and event-sourced: a game is its starting setup
  plus the list of decisions taken, which is what makes undo, save, replay
  and reproducible bug reports all the same feature.
- `src/cards/`: card definitions, plus two generated files: the registry
  (the playable pool) and the catalogue (all 4,149 cards, for the Deck
  Builder's search).
- `src/ai/`: the computer players and their playstyles. They see only a
  masked view of the table and choose from the same list of legal moves a
  human is offered.
- `src/ui/`: the screens. Plain TypeScript and DOM, no framework.
- `src/net/`: online play. The protocol is testable in-memory, without a
  network.
- `config/`: which sets and cards are in the pool, and the playstyle
  attached to each preconstructed deck.
- `docs/`: a design note per mechanic, with rulebook citations.
  `docs/card-status-by-set.md` shows every card by set and whether it is
  playable yet.
- `scripts/`: the KRCG card-data pipeline, the simulator and the bench.

**Card data**

```
npm run cards:fetch      # download the KRCG snapshot -> data/vtes-raw.json
npm run cards:sets       # list set keys -> config/v5-sets.json
npm run cards:registry   # build src/cards/registry.json and src/cards/catalog.json
```

`src/cards/registry.json` and `src/cards/catalog.json` are generated, so
never edit them by hand. `config/supported.json` is hand-maintained, and a
card is only flipped on there once it has an implementation *and* a
passing test.

Read `CLAUDE.md` before changing anything: it is the project's memory, and
it records the decisions and the traps.

**The one dependency** at runtime is `peerjs`, for browser-to-browser
connections. Everything else is TypeScript and the browser.
