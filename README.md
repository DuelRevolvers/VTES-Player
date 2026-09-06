# VTES Player

**Play *Vampire: The Eternal Struggle* in your browser — against friends,
against the computer, or both.**

A free, non-commercial fan project. Nothing to install, nothing to buy, no
account to make.

---

## What is this?

*Vampire: The Eternal Struggle* is a card game where each player is an
ancient vampire — a **Methuselah** — trying to destroy the player to their
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
tablets — there is too much on the table to see at once.

## How to play

**Start a game**

1. Make a profile — just a name, and a picture if you want one. It is
   stored in your own browser and goes nowhere else.
2. Choose **Host a game**.
3. You get a table of four seats: you, and three bots on different
   preconstructed decks. Press **Start** and you are playing.

**Play with other people**

1. On the table screen, change a seat from **Bot** to **Open (online)**.
2. A **room code** appears — something like `K7M2QP`. There is also a
   copy-able join link.
3. Send it to whoever you want to play with. They choose **Join a game**,
   type the code, pick a deck, and they are in.
4. When everyone has arrived, press **Start**.

Any seats you leave as bots stay bots, so you never need a full table to
get a game going.

**Bring your own deck**

Paste a deck list from VDB, Amaranth, ARDB, JOL, Lackey or the tournament
archive — the importer reads all of them. If a card isn't in the pool or
isn't implemented yet, it tells you exactly which line, rather than quietly
dropping it. You can save decks under a name and reuse them.

There are also **32 preconstructed decks** built straight from the official
card data, 18 of which are complete decks you can play as printed. Each one
has a short note about how it wins.

**If you're new to the game**

There's a **How to Play** button at the top of the table with a summary of
the rules, each section tagged with the rulebook page it came from — so you
can check anything against the real book. It has a search box, and it
covers the words that appear on cards but not in the rulebook.

## What's in it

- **Every card in the V5 range** — 661 in all: 444 library cards and 217
  vampires. Every one of them plays correctly. (If you like exact numbers:
  543 needed code written for them; the other 118 are vampires whose card
  text is just their sect and title, so there is nothing to implement.)
- **Computer players** that see only what a real player in that seat would
  see, and choose only from legal moves.
- **Online play for 2–6 people** — though the rulebook recommends four or
  five.
- **Undo, save and load** for local games.
- **Table chat**, in the lobby and during the game.
- **A game log** in plain English, so you can see exactly what happened.

## Some honest limitations

- **There is no server.** No accounts, no matchmaking, and **no list of
  public games** — you play with people you send a code to. Your profile,
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
  player.

## Playing on your own machine

Double-click **`Play VTES.bat`**.

It checks that Node.js is installed, sets things up the first time only,
then opens the game in your browser. The black window that appears **is**
the game's server — leave it open while you play, and close it when you're
done. If Node.js is missing, it tells you where to get it.

To reach it faster: right-click `Play VTES.bat` → **Show more options** →
**Send to** → **Desktop (create shortcut)**.

Playing this way also writes a full log of each game into a `logs/` folder,
which is handy for reporting a bug.

## Playing online

The published version runs on GitHub Pages — see
[PUBLISHING.md](PUBLISHING.md) for how to put your own copy up. It is a
plain static site: no server to run and nothing to pay for.

---

## A note on how this was made

**This project was written with [Claude](https://claude.ai), Anthropic's
AI assistant**, working from the official rulebook and the card data, with
a human directing the design, testing it and making the calls on rules
questions.

That is worth saying plainly for two reasons. If you find a bug, it is
probably a machine-shaped bug rather than a typo — an unusual card
interaction rather than a missing semicolon. And if you want to check
something, the reasoning behind nearly every decision is written down: the
`docs/` folder holds a design note per mechanic, each quoting the rulebook
page it came from, so you can tell a rules summary from an invention.

The whole thing is covered by **1,800+ automated tests**, including
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
buy the real cards — they are lovely, and this is no substitute for
sitting round a table with them.

---

## For developers

```
npm install       # once
npm run play      # server + opens the browser (what the launcher runs)
npm run dev       # server only
npm run typecheck
npm test
npm run simulate  # batch AI games, e.g. -- --games 200 --seed 7
```

**Layout**

- `src/engine/` — the rules, as a pure headless library. No DOM, no
  network. Deterministic and event-sourced: a game is its starting setup
  plus the list of decisions taken, which is what makes undo, save, replay
  and reproducible bug reports all the same feature.
- `src/cards/` — card definitions, and a generated registry.
- `src/ai/` — the computer players. They see only a masked view of the
  table and choose from the same list of legal moves a human is offered.
- `src/ui/` — the screens. Plain TypeScript and DOM, no framework.
- `src/net/` — online play. The protocol is testable in-memory, without a
  network.
- `docs/` — a design note per mechanic, with rulebook citations.
- `scripts/` — the KRCG card-data pipeline.

**Card data**

```
npm run cards:fetch      # download the KRCG snapshot -> data/vtes-raw.json
npm run cards:sets       # list set keys -> config/v5-sets.json
npm run cards:registry   # build src/cards/registry.json
```

`src/cards/registry.json` is generated — never edit it by hand.
`config/supported.json` is hand-maintained, and a card is only flipped on
there once it has an implementation *and* a passing test.

Read `CLAUDE.md` before changing anything: it is the project's memory, and
it records the decisions and the traps.

**The one dependency** at runtime is `peerjs`, for browser-to-browser
connections. Everything else is TypeScript and the browser.
