# Per-playthrough log files

Owner request, 2026-09-04, from the platform shell spec: *"The platform
should create local log files for each playthrough with details of each
play made by players and AI and of any errors that might've occurred so
that these can be reviewed by Claude Code."*

Built the same day, ahead of the rest of the shell, on the reasoning that
a debugging artefact is worth most **while** the hard work (multiplayer,
the deck importer) is being done rather than after it.

---

## 1. The problem the design has to solve first

**A browser cannot write to disk**, and "reviewed by Claude Code" means
the file has to be *in the repo*, not in a Downloads folder that someone
remembered to empty into it.

The answer falls out of how the owner actually plays: `Play VTES.bat` →
`npm run play` → **the Vite dev server**. So a dev-server middleware
(`gameLogPlugin` in `vite.config.ts`) accepts `POST /__vtes_log/<name>`
and appends the body to `logs/<name>`. The file is sitting in the repo
before the game is over, and nobody exported anything.

`apply: "serve"` — it is not in the built bundle. The published static
site has no such endpoint, the POST fails, and `DevServerSink` reports it
**once** to the console and keeps the whole log in memory so it can still
be downloaded. A missing log server is the expected case on GitHub Pages,
not an error.

**The file name arrives over HTTP**, so it is put through `basename` and
then a `^[\w.-]+\.log$` test. Without the first of those, a POST to
`..%2F..%2Fevil.log` would be honoured. Verified end to end: that request
writes `logs/evil.log` and nothing outside `logs/`.

`logs/` is gitignored — these are local debugging artefacts, one per game,
and they would otherwise be a large and permanent diff.

## 2. It is an OBSERVER, not a hook

`GameLog.observe(state)` is handed the state after each change and writes
down whatever is new in `commandLog` and `eventLog` since last time.
Nothing calls into it from the engine loop.

Two things follow, and both are the reason for the shape:

- **It cannot miss a move.** An AI seat's whole turn, an auto-pass, a
  rewind — none of them go through the UI, and all of them show up in
  those two arrays. Instrumenting the *decision sites* would have meant
  finding every one of them, which is the failure this project has hit
  repeatedly (`onAnyUnlock`, `onBleedSuccess`, `onActionAnnounced` — each
  a hook that existed, was documented as general, and quietly did not
  apply to one case).
- **It cannot cause one.** It never chooses, never mutates, and a throwing
  sink is caught and dropped. A test arms a sink that throws on every
  write and plays ten decisions through it.

Because it is keyed on *how far it has got* rather than on being called
once per change, `record()` can be called from `emit()` — the single
funnel every state change already passes through — and the calls that
changed nothing cost nothing.

### 2.1 It lives in the transport

Same argument as the agents and the AI pacing: **the authority sees every
move, and the UI does not.** With two AI seats and auto-pass on, the UI is
asked about exactly one seat all game; a logger in `DebugApp` would have
produced a file with holes in it precisely where the interesting bugs are.
A test pins that: it plays 40 decisions as Alice and asserts Bob and Carol
are all over the file anyway.

## 3. The file is a replay, not just a description

The header carries the **`SETUP` line** (seed, maxTurns, decks — the JSON
round-trips) and every decision line carries its **option id**. Together
those are exactly a `SavedGame`, so the log does not merely describe the
game, it *reproduces* it — architecture principle 2 paying out again.

```
VTES playthrough log
started   2026-09-04T05:54:01.123Z
seed      42
seats     Alice, Bob, Carol
SETUP {"decks":[…],"seed":42,"maxTurns":40}
------------------------------------------------------------------------

#   0  Alice
        > inf:add:V1
        . Alice moves a counter onto a vampire
```

The narrated lines come from `narrate.ts`, the same sentences the in-game
log panel shows. **An event with no sentence still gets a line** (its type
and its JSON): a log that quietly drops what it cannot phrase is a log you
cannot trust.

## 4. Three cases that needed a decision

**Undo.** A rewind replays a *shorter* command log into a fresh engine, so
both arrays get shorter. The logger notices that its counters are ahead of
the game, writes `~~ rewound to decision N ~~`, and re-syncs. Trying to
work out what was taken back would be wasted effort: the lines above are
still a true record of what happened, and the ones below are a true record
of what happens next. Without this the counters would sit ahead for ever
and the file would silently stop — which is the worst failure a log can
have, because it looks like a game that ended.

**Game over.** `finish()` appends the tally and closes the file; a later
`observe()` is ignored, so a stray repaint after the game ends cannot
reopen it. A test asserts `GAME OVER` appears exactly once and that
toggling a setting afterwards adds nothing.

**Redaction: deliberately none.** This is a debugging artefact on the
owner's own disk, and a log that masked the hands would be useless for
exactly the bugs it exists to catch. It is written by the authority and
never travels to a peer, so the hidden-information boundary is untouched.

## 5. Errors

`choose()` wraps the engine call: a rejected option is written to the log
**before** it is re-thrown to be shown to the player. That is the case the
owner asked for by name, and it is the one where the surrounding decisions
matter most — which is why it goes in the same file as the play-by-play
rather than a separate error log.

## 6. Not done yet

- Nothing writes a log outside the browser. `npm run simulate` reports
  crashes with a reproducing seed already; giving the batch harness the
  same file format would make its failures readable the same way.
- There is no UI for the log — no file name shown, no download button for
  the published-site case. `DevServerSink.download()` exists and is
  unwired, pending the shell's Profile menu.
