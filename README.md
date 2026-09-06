# VTES Platform

Online platform for Vampire: The Eternal Struggle (V5 card pool) with AI
players to fill empty seats. Non-commercial fan project under the
[Dark Pack](https://www.paradoxinteractive.com/games/world-of-darkness/community/dark-pack-agreement) agreement. Card data and scans courtesy of [KRCG](https://static.krcg.org/) (official VEKN data, used with permission from Paradox Interactive).

## Playing (no terminal needed)

**Double-click `Play VTES.bat`.**

It checks Node.js is installed, installs the project's libraries the first
time only, starts the local server, and opens the game in your browser.

The black window that appears **is** the server — leave it open while you
play, and close it (or press Ctrl+C in it) to stop. If Node.js is missing
it tells you where to get it.

To get to it faster: right-click `Play VTES.bat` → **Show more options** →
**Send to** → **Desktop (create shortcut)**.

## Setup

```
npm install
```

## Card data pipeline (phase 1)

```
npm run cards:fetch      # download KRCG snapshot -> data/vtes-raw.json
npm run cards:sets       # list set keys; copy the V5 product keys...
# ...into config/v5-sets.json, then:
npm run cards:registry   # build src/cards/registry.json + data/registry-report.txt
```

`config/supported.json` maps card id -> true once a card has an effects
implementation and passing scenario test. The pipeline never edits it.

## Dev

```
npm run typecheck
npm test
npm run dev     # server only, no browser
npm run play    # server + opens the browser (what the launcher runs)
```

## Architecture (summary)

- `src/engine/` — pure, headless, deterministic rules kernel (no DOM, no net)
- `src/cards/` — registry types + generated registry.json
- `scripts/` — KRCG data pipeline
- AI and UI layers land in later phases; see the build plan.
